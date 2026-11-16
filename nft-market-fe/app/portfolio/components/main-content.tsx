import { Box, History, DollarSign, Wallet, LayoutGrid, List, TableProperties, Grid, Edit3, X, ExternalLink, Clock, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEffect, useState } from "react"
import { ListingDialog } from "./listingDailog"
import CollectionsApi from "@/api/collections"
import { request } from "@/api/request"
import { useAccount } from "wagmi"
import { ethers, formatEther, parseEther } from "ethers"
import { SaleKind, Side, makeOrders, cancelOrder, editOrder } from "@/contracts/service/orderBookContract"
import { useEthersSigner } from "../../../hooks/useEthersSigner"
import { ImportNftPanel } from "./import-nft-panel"

export function MainContent({myListOrders, onOrderChanged}: {myListOrders: any[], onOrderChanged?: () => void}) {

  const [listingDialogOpen, setListingDialogOpen] = useState(false);
  const [collections, setCollections] = useState<any[]>([]);
  const [canListNfts, setCanListNfts] = useState<any[]>([]);
  const [myNfts, setMyNfts] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedNfts, setSelectedNfts] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<{ [key: string]: string }>({});
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [isListing, setIsListing] = useState(false);
  const [listingStatus, setListingStatus] = useState<string>('');
  const [myBids, setMyBids] = useState<any[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [editDialog, setEditDialog] = useState<{ open: boolean; orderKey: string; collection: string; tokenId: string; maker: string; oldPrice: string; oldExpiry: number; oldSalt: number } | null>(null);
  const [editPrice, setEditPrice] = useState("");
  // 通用消息弹窗（替代 alert，支持复制）
  const [msg, setMsg] = useState<{ type: "success" | "error" | "info"; title: string; detail?: string } | null>(null);
  const { address } = useAccount();
  const signer = useEthersSigner();

  const notify = (type: "success" | "error" | "info", title: string, detail?: string) => {
    setMsg({ type, title, detail });
  };
  const copyMsg = async () => {
    if (!msg) return;
    const text = msg.detail ? `${msg.title}\n${msg.detail}` : msg.title;
    try {
      await navigator.clipboard.writeText(text);
      notify(msg.type, msg.title, msg.detail ? msg.detail + "\n\n（已复制到剪贴板）" : "已复制到剪贴板");
    } catch {
      // 剪贴板权限不可用时，用户仍可手动选中复制文本
    }
  };

  async function loadCollections() {
    // @ts-ignore
    const {result} = await CollectionsApi.GetCollections({
      limit: 100,
      range: '7d',
    })

    setCollections(result);
    
  }

  async function loadMyNfts() {
    if (!address) return;

    try {
      // 走自己的后端 API（不依赖 Alchemy）
      const filters = JSON.stringify({
        chain_id: [11155111],
        user_addresses: [address],
        page: 1,
        page_size: 100,
      });
      const resp = await request.get("/portfolio/items", {
        params: { filters },
      });
      // request 拦截器已剥掉外层 data，resp 即 { result, count }
      const items = (resp as any)?.result || resp || [];

      console.log("我的 NFT（后端）:", items);

      // 后端 PortfolioItemInfo → 前端展示所需的 Alchemy 风格字段
      const normalized = items.map((it: any) => ({
        name: it.name || `${it.collection_name || "NFT"} #${it.token_id}`,
        tokenId: it.token_id,
        contract: {
          address: it.collection_address,
          name: it.collection_name || "MetaNodeNFT",
          symbol: "MetaNode",
        },
        image: it.image_uri
          ? { originalUrl: it.image_uri, cachedUrl: it.image_uri }
          : null,
        description: "",
        // 是否有活跃挂单（有则不可再次挂单，避免重复 approve 报错）
        isListed: !!it.list_order_id && it.list_order_id !== "",
        listOrderId: it.list_order_id || "",
      }));

      setMyNfts(normalized);
    } catch (err) {
      console.error("获取 NFT 失败:", err);
      setMyNfts([]);
    }
  }

  useEffect(() => {
    if (address) {
      loadMyNfts()
    }
  }, [address])

  // 加载我的出价
  async function loadMyBids() {
    if (!address) return;
    setBidsLoading(true);
    try {
      const filters = JSON.stringify({
        chain_id: [11155111],
        user_addresses: [address],
        page: 1,
        page_size: 50,
      });
      const resp = await request.get("/portfolio/bids", { params: { filters } });
      const result = (resp as any)?.result || resp || [];
      const flatBids: any[] = [];
      (result || []).forEach((item: any) => {
        (item.bid_infos || []).forEach((bi: any) => {
          flatBids.push({
            ...bi,
            collection_address: item.collection_address,
            collection_name: item.collection_name,
            token_id: item.token_id,
            image_uri: item.image_uri,
            chain_id: item.chain_id,
          });
        });
      });
      setMyBids(flatBids);
    } catch (err) {
      console.error("加载出价失败:", err);
      setMyBids([]);
    } finally {
      setBidsLoading(false);
    }
  }

  useEffect(() => {
    if (address) {
      loadMyBids();
    }
  }, [address])

  // 切到别的 tab 或定期刷新（出价/成交后数据可能由 sync 延迟写入）
  useEffect(() => {
    const timer = setInterval(() => {
      if (address) loadMyBids();
    }, 8000); // 每 8 秒刷新出价记录
    return () => clearInterval(timer);
  }, [address])

  useEffect(() => {
    loadCollections()
  }, [])

  // 过滤当前可以挂单的 NFT：只保留链上 ownerOf == 当前钱包 的
  // 后端 list_order_id 可能因同步延迟为空，不能作为唯一依据；
  // 已挂单的 NFT 会转入 Vault，此时 ownerOf 不是用户，直接 approve 会
  // revert ERC721InvalidApprover(auth)。这里以链上 owner 为最终护栏。
  useEffect(() => {
    let cancelled = false;

    async function filterByOwner() {
      if (!signer || !address || myNfts.length === 0) {
        if (!cancelled) setCanListNfts([]);
        return;
      }

      const checked = await Promise.all(
        myNfts.map(async (it: any) => {
          if (it.isListed) return null;
          try {
            const nft = new ethers.Contract(
              it.contract.address,
              ["function ownerOf(uint256 tokenId) view returns (address)"],
              signer
            );
            const owner: string = await nft.ownerOf(it.tokenId);
            return owner.toLowerCase() === address.toLowerCase() ? it : null;
          } catch (e) {
            console.warn("ownerOf 读取失败，跳过该 NFT", it.contract.address, it.tokenId, e);
            return null;
          }
        })
      );

      if (!cancelled) setCanListNfts(checked.filter(Boolean) as any[]);
    }

    filterByOwner().catch((e) => {
      console.error("过滤可挂单 NFT 失败:", e);
      if (!cancelled) setCanListNfts([]);
    });

    return () => {
      cancelled = true;
    };
  }, [signer, address, myNfts])

  function openListingDialog() {
    setListingDialogOpen(true);
  }

  function closeListingDialog() {
    setListingDialogOpen(false);
  }

  const toggleNftSelection = (nftKey: string) => {
    const newSelected = new Set(selectedNfts);
    if (newSelected.has(nftKey)) {
      newSelected.delete(nftKey);
    } else {
      newSelected.add(nftKey);
    }
    setSelectedNfts(newSelected);
  };

  const updatePrice = (nftKey: string, price: string) => {
    setPrices(prev => ({
      ...prev,
      [nftKey]: price
    }));
  };

  const handleImageError = (nftKey: string) => {
    setImageErrors(prev => new Set([...prev, nftKey]));
  };

  const handleBatchListing = async () => {
    if (!signer || !address) {
      notify("error", "请先连接钱包");
      return;
    }

    const selectedNftData = canListNfts.filter(nft => {
      const nftKey = `${nft.contract.address}-${nft.tokenId}`;
      return selectedNfts.has(nftKey);
    }).map(nft => ({
      ...nft,
      price: prices[`${nft.contract.address}-${nft.tokenId}`] || '0'
    }));

    // 验证价格
    const invalidPrices = selectedNftData.filter(nft => 
      !nft.price || parseFloat(nft.price) <= 0
    );
    
    if (invalidPrices.length > 0) {
      notify("error", "请为所有选中的NFT设置有效的价格");
      return;
    }

    try {
      setIsListing(true);
      setListingStatus('准备创建订单...');
      
      const now = Math.floor(Date.now() / 1000) + 100000;
      const orders = selectedNftData.map((nft, index) => ({
        side: Side.List,
        saleKind: SaleKind.FixedPriceForItem,
        maker: address,
        nft: {
          tokenId: nft.tokenId,
          collection: nft.contract.address,
          amount: 1
        },
        price: parseEther(nft.price),
        expiry: now,
        salt: Date.now() + index,
      }));

      console.log('准备创建的订单:', orders);
      setListingStatus('检查并授权NFT...');

      const result = await makeOrders(signer, orders, {
        autoApprove: true
      });
      
      console.log('挂单成功:', result);
      setListingStatus('挂单成功！');
      notify("success", "挂单成功", `交易哈希: ${result.transactionHash}`);
      
      // 重置状态
      setSelectedNfts(new Set());
      setPrices({});
      
    } catch (error: any) {
      console.error('挂单失败:', error);
      let errorMessage = error.message;
      
      if (errorMessage.includes('missing revert data')) {
        errorMessage = '交易可能会失败，请检查：\n1. NFT是否属于您\n2. 价格是否有效\n3. 网络是否正确\n4. 钱包余额是否足够支付gas费';
      } else if (errorMessage.includes('user rejected')) {
        errorMessage = '用户取消了交易';
      } else if (errorMessage.includes('insufficient funds')) {
        errorMessage = 'gas费不足，请确保钱包有足够的ETH';
      }
      
      notify("error", "挂单失败", errorMessage);
    } finally {
      setIsListing(false);
      setListingStatus('');
    }
  };

  const handleCancelOrder = async (orderKey: string) => {
    if (!signer) { notify("error", "请先连接钱包"); return; }
    try {
      setIsListing(true);
      setListingStatus('取消挂单中...');
      await cancelOrder(signer, orderKey);
      notify("success", "挂单已取消");
      onOrderChanged?.();
    } catch (e: any) { notify("error", "取消失败", e?.message); }
    finally { setIsListing(false); setListingStatus(''); }
  };

  const handleEditOrder = async (orderKey: string, collection: string, tokenId: string, maker: string, oldExpiry: number, oldSalt: number) => {
    if (!signer) { notify("error", "请先连接钱包"); return; }
    const price = parseFloat(editPrice);
    if (!price || price <= 0) { notify("error", "请输入有效的新价格"); return; }
    try {
      setIsListing(true);
      setListingStatus('编辑挂单中...');
      await editOrder(signer, orderKey, editPrice, collection, tokenId, maker, oldExpiry, oldSalt);
      notify("success", "挂单已更新");
      setEditDialog(null);
      setEditPrice("");
      onOrderChanged?.();
    } catch (e: any) { notify("error", "编辑失败", e?.message); }
    finally { setIsListing(false); setListingStatus(''); }
  };

  // 取消出价
  const handleCancelBid = async (orderKey: string) => {
    if (!signer) { notify("error", "请先连接钱包"); return; }
    try {
      setIsListing(true);
      setListingStatus('取消出价中...');
      await cancelOrder(signer, orderKey);
      notify("success", "出价已取消，ETH 已退回");
      loadMyBids();
    } catch (e: any) { notify("error", "取消失败", e?.message); }
    finally { setIsListing(false); setListingStatus(''); }
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  };

  const [tabIndex, setTabIndex] = useState(0)

  // 计算统计数据
  const totalListings = myListOrders.length;
  const totalValue = myListOrders.reduce((sum, order) => {
    try {
      return sum + parseFloat(formatEther(order.price || '0'));
    } catch {
      return sum;
    }
  }, 0);

  return (
    <div className="flex-1 p-4 bg-gray-900 min-h-screen">
      <ListingDialog canListNfts={canListNfts} collections={collections} open={listingDialogOpen} close={closeListingDialog} />

      {/* 编辑价格弹窗 */}
      {editDialog?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 rounded-xl p-6 w-80 space-y-4">
            <h3 className="text-lg font-semibold text-white">编辑挂单 #{editDialog.tokenId}</h3>
            <Input
              type="number" step="0.001" min="0"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              placeholder="新价格 (ETH)"
              className="bg-gray-700 border-gray-600 text-white"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditDialog(null)} className="border-gray-600 text-gray-300">取消</Button>
              <Button
                onClick={() => handleEditOrder(editDialog.orderKey, editDialog.collection, editDialog.tokenId, editDialog.maker, editDialog.oldExpiry, editDialog.oldSalt)}
                disabled={isListing}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isListing ? listingStatus || '编辑中...' : '确认'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 页面头部 */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">我的投资组合</h1>
          <p className="text-gray-400 mt-1">管理您的NFT资产和挂单</p>
        </div>
        <div className="flex items-center space-x-6">
          <div className="text-sm text-gray-400 space-x-6">
            <span className="inline-flex items-center">
              <span className="text-white font-medium">{totalListings}</span>
              <span className="ml-1">已挂单</span>
            </span>
            <span className="inline-flex items-center">
              <span className="text-white font-medium">{totalValue.toFixed(3)} ETH</span>
              <span className="ml-1">总估值</span>
            </span>
            <span className="inline-flex items-center">
              <TrendingUp className="h-4 w-4 text-green-400 mr-1" />
              <span className="text-green-400">+0.00%</span>
            </span>
          </div>
        </div>
      </div>

      {/* 标签页导航 */}
      <div className="mb-6">
        <div className="flex items-center space-x-4 border-b border-gray-700">
          <Button 
            variant="ghost" 
            className={`text-white border-b-2 ${tabIndex === 0 ? 'border-purple-400 text-purple-400' : 'border-transparent'} rounded-none hover:text-purple-400`} 
            onClick={() => setTabIndex(0)}
          >
            <Box className="h-4 w-4 mr-2" />
            库存 ({myNfts.length})
          </Button>
          <Button 
            variant="ghost" 
            className={`text-white border-b-2 ${tabIndex === 1 ? 'border-purple-400 text-purple-400' : 'border-transparent'} rounded-none hover:text-purple-400`} 
            onClick={() => setTabIndex(1)}
          >
            <History className="h-4 w-4 mr-2" />
            挂单记录 ({totalListings})
          </Button>
          <Button 
            variant="ghost" 
            className={`text-white border-b-2 ${tabIndex === 2 ? 'border-purple-400 text-purple-400' : 'border-transparent'} rounded-none hover:text-purple-400`} 
            onClick={() => setTabIndex(2)}
          >
            <DollarSign className="h-4 w-4 mr-2" />
            出价记录
          </Button>
          <Button 
            variant="ghost" 
            className={`text-white border-b-2 ${tabIndex === 3 ? 'border-purple-400 text-purple-400' : 'border-transparent'} rounded-none hover:text-purple-400`} 
            onClick={() => setTabIndex(3)}
          >
            <Wallet className="h-4 w-4 mr-2" />
            交易历史
          </Button>
        </div>
      </div>

      {/* 库存页面内容 */}
      {tabIndex === 0 && (
        <div>
          {/* 导入 NFT 面板 */}
          <ImportNftPanel
            visible={showImportForm}
            address={address}
            chainId={11155111}
            myItems={myNfts}
            onClose={() => setShowImportForm(false)}
            onImported={async () => {
              await loadMyNfts();
              setShowImportForm(false);
            }}
          />

          {/* 视图控制和操作栏 */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg font-semibold text-white">我的NFT库存</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowImportForm((prev) => !prev)}
                className="text-xs"
              >
                导入 NFT
              </Button>
              {canListNfts.length > 0 && (
                <span className="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded-full">
                  {canListNfts.length} 个可挂单NFT
                </span>
              )}
              {selectedNfts.size > 0 && (
                <span className="px-2 py-1 bg-purple-600/20 text-purple-400 text-xs rounded-full">
                  已选择 {selectedNfts.size} 个
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewMode('grid')}
                className={`${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewMode('list')}
                className={`${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* NFT库存列表 */}
          {canListNfts.length === 0 ? (
            // <div>const arr = [];
            <div className="text-center py-16">
              <div className="text-6xl mb-4">🎨</div>
              <h3 className="text-xl font-semibold text-white mb-2">暂无可挂单的NFT</h3>
              <p className="text-gray-400 mb-6">请确保您拥有支持的NFT集合</p>
            </div>
          ) : (
            <div className={`${viewMode === 'grid' 
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' 
              : 'space-y-4'
            }`}>
              {canListNfts.map(nft => {
                const nftKey = `${nft.contract.address}-${nft.tokenId}`;
                const isSelected = selectedNfts.has(nftKey);
                
                return (
                  <div
                    key={nftKey}
                    className={`relative rounded-xl border-2 transition-all duration-200 cursor-pointer ${
                      isSelected 
                        ? 'border-purple-400 bg-purple-900/20 shadow-lg shadow-purple-400/20' 
                        : 'border-gray-600 bg-gray-800/50 hover:border-gray-500'
                    } ${viewMode === 'grid' ? 'p-4' : 'p-4 flex items-center space-x-4'}`}
                    onClick={() => toggleNftSelection(nftKey)}
                  >
                    {/* 选中状态指示器 */}
                    {isSelected && (
                      <div className="absolute top-3 right-3 z-10">
                        <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                          <div className="w-3 h-3 bg-white rounded-full" />
                        </div>
                      </div>
                    )}
                    
                    {/* NFT 图片 */}
                    <div className={`${viewMode === 'grid' ? 'aspect-square mb-4' : 'w-16 h-16 flex-shrink-0'} rounded-lg overflow-hidden bg-gray-700 relative`}>
                      {!imageErrors.has(nftKey) && (
                        <img 
                          src={nft.image?.cachedUrl || nft.image?.originalUrl} 
                          alt={nft.name || `Token #${nft.tokenId}`}
                          className="w-full h-full object-cover transition-transform duration-200 hover:scale-105"
                          onError={() => handleImageError(nftKey)}
                        />
                      )}
                      {/* 占位图片 */}
                      {imageErrors.has(nftKey) && (
                        <div className="absolute inset-0 bg-gray-700 flex items-center justify-center text-gray-400">
                          <div className="text-center">
                            <div className={`${viewMode === 'grid' ? 'text-4xl mb-2' : 'text-2xl'}`}>🖼️</div>
                            {viewMode === 'grid' && <div className="text-xs">图片加载失败</div>}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* NFT 信息 */}
                    <div className={`${viewMode === 'grid' ? 'space-y-3' : 'flex-1 space-y-2'}`}>
                      <div>
                        <h3 className="font-semibold text-white truncate">
                          {nft.name || `${nft.contract.name} #${nft.tokenId}`}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded-md">
                            {nft.contract.symbol}
                          </span>
                          <span className="text-xs text-gray-400">#{nft.tokenId}</span>
                        </div>
                      </div>
                      
                      {/* 描述 - 仅在网格视图显示 */}
                      {viewMode === 'grid' && nft.description && (
                        <p className="text-sm text-gray-400 line-clamp-2">
                          {nft.description}
                        </p>
                      )}
                      
                      {/* 价格输入 */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300">
                          挂单价格 (ETH)
                        </label>
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="0.000"
                          value={prices[nftKey] || ''}
                          onChange={(e) => updatePrice(nftKey, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:border-purple-400"
                        />
                      </div>
                      
                      {/* 合约信息 - 仅在网格视图显示 */}
                      {viewMode === 'grid' && (
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="truncate flex-1">
                            {nft.contract.address.slice(0, 6)}...{nft.contract.address.slice(-4)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`https://sepolia.etherscan.io/address/${nft.contract.address}`, '_blank');
                            }}
                            className="h-6 w-6 p-0 text-gray-500 hover:text-gray-300"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 批量操作面板 */}
          {selectedNfts.size > 0 && (
            <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-xl p-4 shadow-2xl">
              <div className="flex items-center space-x-4">
                <span className="text-white font-medium">
                  已选择 {selectedNfts.size} 个NFT
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedNfts(new Set());
                    setPrices({});
                  }}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  清空选择
                </Button>
                <Button
                  onClick={handleBatchListing}
                  disabled={isListing}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {isListing 
                    ? (listingStatus || '挂单中...') 
                    : `批量挂单 (${selectedNfts.size})`
                  }
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 挂单记录页面内容 */}
      {tabIndex === 1 && (
        <div>
          {/* 视图控制和操作栏 */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg font-semibold text-white">挂单记录</h2>
              {myListOrders.length > 0 && (
                <span className="px-2 py-1 bg-purple-600/20 text-purple-400 text-xs rounded-full">
                  {myListOrders.length} 个活跃订单
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewMode('grid')}
                className={`${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewMode('list')}
                className={`${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 挂单列表 */}
          {myListOrders.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">📝</div>
              <h3 className="text-xl font-semibold text-white mb-2">暂无挂单记录</h3>
              <p className="text-gray-400 mb-6">您还没有创建任何挂单，开始挂单来出售您的NFT</p>
              <Button 
                onClick={() => setTabIndex(0)}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                去库存页面挂单
              </Button>
            </div>
          ) : (
            <div className={`${viewMode === 'grid' 
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' 
              : 'space-y-4'
            }`}>
              {myListOrders.map((order) => (
                <div
                  key={order.collection_address + "_" + order.token_id}
                  className={`bg-gray-800 rounded-xl border border-gray-700 hover:border-purple-400 transition-all duration-200 ${
                    viewMode === 'grid' ? 'p-4' : 'p-4 flex items-center space-x-4'
                  }`}
                >
                  {/* NFT 图片 */}
                  <div className={`${viewMode === 'grid' ? 'aspect-square mb-4' : 'w-16 h-16 flex-shrink-0'} rounded-lg overflow-hidden bg-gray-700`}>
                    <img
                      src={order.image_uri || order.collection_image_uri}
                      alt={order.name || 'NFT'} 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjMzc0MTUxIi8+CjxwYXRoIGQ9Ik0xMDAgNTBMMTUwIDEyNUg1MEwxMDAgNTBaIiBmaWxsPSIjNkI3Mjg1Ii8+Cjx0ZXh0IHg9IjEwMCIgeT0iMTYwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIgZmlsbD0iIzlDQTNBRiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TkZUPC90ZXh0Pgo8L3N2Zz4K';
                      }}
                    />
                  </div>

                  {/* NFT 信息 */}
                  <div className={`${viewMode === 'grid' ? '' : 'flex-1'}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-white truncate">
                          {order.name || `#${order.token_id}`}
                        </h3>
                        <p className="text-sm text-gray-400 truncate">
                          {order.collection_name || "MetaNodeNFT"}
                        </p>
                      </div>
                      {viewMode === 'grid' && (
                        <span className="px-2 py-1 bg-green-600/20 text-green-400 text-xs rounded-full">
                          活跃
                        </span>
                      )}
                    </div>

                    {/* 价格和状态 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">挂单价格</span>
                        <span className="font-semibold text-white">
                          {(() => {
                            try {
                              return `${parseFloat(formatEther(order.list_price || '0')).toFixed(3)} ETH`;
                            } catch {
                              return '0.000 ETH';
                            }
                          })()}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">创建时间</span>
                        <span className="text-sm text-gray-300 flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          {formatTimeAgo(order.list_time || Date.now())}
                        </span>
                      </div>

                      {viewMode === 'list' && (
                        <span className="inline-flex px-2 py-1 bg-green-600/20 text-green-400 text-xs rounded-full">
                          活跃
                        </span>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className={`${viewMode === 'grid' ? 'mt-4' : 'mt-2'} flex gap-2`}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditDialog({
                            open: true,
                            orderKey: order.list_order_id,
                            collection: order.collection_address,
                            tokenId: order.token_id,
                            maker: order.owner || order.list_maker || order.maker,
                            oldPrice: order.list_price || "0",
                            oldExpiry: order.list_expire_time || 0,
                            oldSalt: order.list_salt || 0,
                          });
                          setEditPrice((() => { try { return parseFloat(formatEther(order.list_price || '0')).toString(); } catch { return ''; } })());
                        }}
                        className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
                      >
                        <Edit3 className="h-3 w-3 mr-1" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancelOrder(order.list_order_id)}
                        className="flex-1 border-red-600/50 text-red-400 hover:bg-red-600/10 hover:border-red-500"
                      >
                        <X className="h-3 w-3 mr-1" />
                        取消
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => window.open(`https://sepolia.etherscan.io/address/${order.collection_address}`, '_blank')}
                        className="p-2 text-gray-400 hover:text-white"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 出价记录页面内容 */}
      {tabIndex === 2 && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg font-semibold text-white">出价记录</h2>
              {myBids.length > 0 && (
                <span className="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded-full">
                  {myBids.length} 个活跃出价
                </span>
              )}
            </div>
          </div>

          {bidsLoading ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">⏳</div>
              <h3 className="text-xl font-semibold text-white mb-2">加载中...</h3>
            </div>
          ) : myBids.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">💰</div>
              <h3 className="text-xl font-semibold text-white mb-2">暂无出价记录</h3>
              <p className="text-gray-400">前往 NFT 详情页对你感兴趣的 NFT 出价</p>
            </div>
          ) : (
            <div className="space-y-4">
              {myBids.map((bid, idx) => (
                <div key={idx} className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-700 flex-shrink-0">
                      {bid.image_uri ? (
                        <img src={bid.image_uri} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">🖼️</div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-white">{bid.collection_name || "NFT"} #{bid.token_id}</h3>
                          <p className="text-sm text-gray-400">{bid.collection_address?.slice(0,6)}...{bid.collection_address?.slice(-4)}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-blue-400">
                            {(() => {
                              try { return `${parseFloat(formatEther(bid.bid_price || '0')).toFixed(4)} ETH`; }
                              catch { return '0 ETH'; }
                            })()}
                          </div>
                          <span className="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded-full">活跃出价</span>
                        </div>
                      </div>
                      {bid.bid_expire_time && (
                        <p className="text-xs text-gray-500 mt-1">过期时间: {new Date(bid.bid_expire_time * 1000).toLocaleString()}</p>
                      )}
                      <div className="mt-2">
                        <Button
                          size="sm" variant="outline"
                          onClick={() => handleCancelBid(bid.bid_order_id)}
                          className="border-red-600/50 text-red-400 hover:bg-red-600/10 hover:border-red-500 text-xs h-7"
                        >
                          <X className="h-3 w-3 mr-1" />取消出价
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tabIndex === 3 && (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📈</div>
          <h3 className="text-xl font-semibold text-white mb-2">交易历史</h3>
          <p className="text-gray-400">此功能正在开发中...</p>
        </div>
      )}

      {/* 底部操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-700 bg-gray-900/95 backdrop-blur-sm p-4">
        <div className="flex justify-center space-x-4">
          <Button 
            className="bg-purple-600 hover:bg-purple-700 text-white" 
            onClick={() => setTabIndex(0)}
          >
            库存管理 ({canListNfts.length})
          </Button>
          <Button 
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => setTabIndex(1)}
          >
            挂单记录 ({totalListings})
          </Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white">
            更多功能
          </Button>
        </div>
      </div>

      {/* 通用消息弹窗（替代 alert，支持复制） */}
      {msg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setMsg(null)}>
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold ${msg.type === "error" ? "text-red-400" : msg.type === "success" ? "text-green-400" : "text-white"}`}>
              {msg.type === "error" ? "❌ " : msg.type === "success" ? "✅ " : "ℹ️ "}{msg.title}
            </h3>
            {msg.detail && (
              <textarea
                readOnly
                value={msg.detail}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full h-32 bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-gray-300 font-mono resize-none focus:outline-none focus:border-purple-500"
              />
            )}
            <div className="flex gap-2 justify-end">
              {msg.detail && (
                <Button variant="outline" onClick={copyMsg} className="border-gray-600 text-gray-300">复制</Button>
              )}
              <Button onClick={() => setMsg(null)} className="bg-purple-600 hover:bg-purple-700 text-white">关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

