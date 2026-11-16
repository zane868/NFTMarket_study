"use client";

import { useState, useRef } from "react";
import { useAccount, useChainId } from "wagmi";
import axios from "axios";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
  Upload,
  Image as ImageIcon,
} from "lucide-react";
import {
  uploadFileToCOSPost as uploadFileToCOS,
  uploadMetadataToCOSPost as uploadMetadataToCOS,
  type NFTMetadata,
} from "@/lib/cos-upload-post";

// Sepolia 测试网链 ID
const SEPOLIA_CHAIN_ID = 11155111;

// 扩展 Window 接口以支持 ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function MintPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 表单状态
  const [nftName, setNftName] = useState<string>("");
  const [nftDescription, setNftDescription] = useState<string>("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [mintAddress, setMintAddress] = useState<string>("");

  // 流程状态
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");
  const [tokenId, setTokenId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState(false);
  
  // 处理图片选择
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // 检查文件类型
      if (!file.type.startsWith("image/")) {
        setError("请选择图片文件");
        return;
      }

      // 检查文件大小（限制为 10MB）
      if (file.size > 10 * 1024 * 1024) {
        setError("图片大小不能超过 10MB");
        return;
      }

      setSelectedImage(file);
      setError("");

      // 创建预览
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // 铸造 NFT
  const handleMint = async () => {
    // 验证表单
    if (!isConnected || !address) {
      setError("请先连接钱包");
      return;
    }

    if (chainId !== SEPOLIA_CHAIN_ID) {
      setError("请切换到 Sepolia 测试网");
      return;
    }

    if (!nftName.trim()) {
      setError("请输入 NFT 名称");
      return;
    }

    if (!nftDescription.trim()) {
      setError("请输入 NFT 描述");
      return;
    }

    if (!selectedImage) {
      setError("请选择 NFT 图片");
      return;
    }

    const targetAddress = mintAddress || address;
    if (!targetAddress) {
      setError("接收地址无效");
      return;
    }
    
    // 简单验证以太坊地址格式
    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
      setError("接收地址格式不正确");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess(false);
    setTxHash("");
    setTokenId("");

    try {
      // 步骤 1: 上传图片到 COS（服务端代理）
      setCurrentStep("正在上传图片到云存储...");
      const imageUrl = await uploadFileToCOS(selectedImage);
      console.log("图片上传成功:", imageUrl);

      // 步骤 2: 创建并上传 Metadata
      setCurrentStep("正在创建 NFT Metadata...");
      const metadata: NFTMetadata = {
        name: nftName,
        description: nftDescription,
        image: imageUrl,
        attributes: [
          {
            trait_type: "Creator",
            value: address || "",
          },
          {
            trait_type: "Created At",
            value: new Date().toISOString(),
          },
        ],
      };

      console.log("创建的 Metadata:", metadata);
      const metadataUrl = await uploadMetadataToCOS(metadata);
      console.log("Metadata 上传成功:", metadataUrl);

      // 步骤 3: 调用后端 API 铸造 NFT
      setCurrentStep("正在铸造 NFT...");
      console.log("调用后端 API 铸造 NFT...");

      const mintResponse = await axios.post("/api/v1/metanode/mint", {
        chain_id: SEPOLIA_CHAIN_ID,
        to_address: targetAddress,
        token_uri: metadataUrl,
        name: nftName,
        description: nftDescription,
        image: imageUrl,
      });

      console.log("铸造响应:", mintResponse.data);

      // 从响应中获取交易信息
      // 优先从 data.data 中获取，适配 { code: 200, data: { ... } } 格式
      const responseData = mintResponse.data.data || mintResponse.data;
      const mintResult = responseData.result || responseData;

      const txHash = mintResult.tx_hash || responseData.transaction_id || mintResult.transaction_id;
      const tokenIdResult = mintResult.token_id || responseData.token_id || mintResult.token_id;

      if (txHash) {
        setTxHash(txHash);
        setCurrentStep("等待交易确认...");
        console.log("交易哈希:", txHash);
      }

      if (tokenIdResult) {
        setTokenId(tokenIdResult.toString());
        console.log("Token ID:", tokenIdResult);
      }

      // 检查铸造状态
      if (
        mintResult.status === "confirmed" ||
        responseData.message?.includes("successfully") ||
        mintResponse.data.msg === "Successful"
      ) {
        setSuccess(true);
        setError("");
        setCurrentStep("");
        console.log("NFT 铸造成功！");
      } else if (mintResult.status === "pending") {
        // 如果交易还在等待确认
        setCurrentStep("交易已提交，等待区块链确认...");
        // 可以继续等待或显示成功
        setTimeout(() => {
          setSuccess(true);
          setError("");
          setCurrentStep("");
        }, 2000);
      } else {
        setError("铸造失败，请重试");
        setCurrentStep("");
      }
    } catch (err: any) {
      console.error("铸造失败:", err);
      setError(err.message || "铸造失败，请重试");
      setSuccess(false);
      setCurrentStep("");
    } finally {
      setLoading(false);
    }
  };

  // 重置表单
  const resetForm = () => {
    setNftName("");
    setNftDescription("");
    setSelectedImage(null);
    setImagePreview("");
    setMintAddress("");
    setTxHash("");
    setTokenId("");
    setError("");
    setSuccess(false);
    setCurrentStep("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 添加 NFT 到钱包
  const addNFTToWallet = async () => {
    if (!window.ethereum || !tokenId) {
      setError("无法连接钱包或缺少 Token ID");
      return;
    }

    try {
      // 使用 EIP-1193 添加 NFT 到钱包
      // 注意：并非所有钱包都支持此功能
      const wasAdded = await window.ethereum.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC721",
          options: {
            address: "0x8DE7E4217A1254B1bB1afC8F33Ba5d325BcA4664",
            tokenId: tokenId,
          },
        },
      });

      if (wasAdded) {
        console.log("NFT 已添加到钱包！");
      } else {
        console.log("用户取消了添加");
      }
    } catch (error: any) {
      console.error("添加 NFT 到钱包失败:", error);
      
      // 如果钱包不支持 ERC721，尝试作为 ERC20 添加（某些钱包的兼容方式）
      try {
        const wasAdded = await window.ethereum.request({
          method: "wallet_watchAsset",
          params: {
            type: "ERC20",
            options: {
              address: "0x8DE7E4217A1254B1bB1afC8F33Ba5d325BcA4664",
              symbol: "MNODE",
              decimals: 0,
              image: imagePreview || "",
            },
          },
        });
        
        if (wasAdded) {
          console.log("合约已添加到钱包！");
        }
      } catch (fallbackError) {
        // 如果两种方式都失败，提示用户手动添加
        setError(
          "当前钱包可能不支持自动添加 NFT。\n" +
          "你可以在钱包中手动添加 NFT 合约地址和 Token ID：\n" +
          `合约地址: 0x8DE7E4217A1254B1bB1afC8F33Ba5d325BcA4664\n` +
          `Token ID: ${tokenId}`
        );
      }
    }
  };

  // 使用当前地址
  const fillMyAddress = () => {
    if (address) {
      setMintAddress(address);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/80">
      <div className="container mx-auto px-4 py-12">
        {/* 标题区域 */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-4">
            <Sparkles className="h-8 w-8 text-primary mr-3" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
              铸造 NFT
            </h1>
          </div>
          <p className="text-muted-foreground text-lg">
            创建您的专属 NFT 数字资产
          </p>
        </div>

        {/* 主要内容卡片 */}
        <div className="max-w-3xl mx-auto">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-8">
            {!isConnected ? (
              <div className="text-center py-12">
                <div className="bg-muted rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold mb-2">连接钱包开始铸造</h3>
                <p className="text-muted-foreground">
                  请先连接您的钱包以继续铸造 NFT
                </p>
              </div>
            ) : chainId !== SEPOLIA_CHAIN_ID ? (
              <div className="text-center py-12">
                <div className="bg-yellow-500/10 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                  <XCircle className="h-10 w-10 text-yellow-500" />
                </div>
                <h3 className="text-xl font-semibold mb-2">请切换网络</h3>
                <p className="text-muted-foreground">
                  当前合约部署在 Sepolia 测试网，请切换到该网络
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* 图片上传区域 */}
                <div className="space-y-2">
                  <Label htmlFor="image" className="text-base font-semibold">
                    NFT 图片
                  </Label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="relative border-2 border-dashed border-border rounded-xl p-8 hover:border-primary transition-colors cursor-pointer group"
                  >
                    {imagePreview ? (
                      <div className="relative">
                        <img
                          src={imagePreview}
                          alt="NFT Preview"
                          className="w-full h-64 object-contain rounded-lg"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <p className="text-white font-medium">点击更换图片</p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <div className="bg-muted rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                          <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <div className="flex items-center justify-center mb-2">
                          <Upload className="h-5 w-5 text-primary mr-2" />
                          <span className="text-base font-medium">
                            点击上传图片
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          支持 JPG、PNG、GIF，最大 10MB
                        </p>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      id="image"
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                  </div>
                </div>

                {/* NFT 名称 */}
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-base font-semibold">
                    NFT 名称
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="例如：My Awesome NFT"
                    value={nftName}
                    onChange={(e) => setNftName(e.target.value)}
                    className="bg-background border-border h-12"
                  />
                  <p className="text-xs text-muted-foreground">
                    为您的 NFT 起一个独特的名字
                  </p>
                </div>

                {/* NFT 描述 */}
                <div className="space-y-2">
                  <Label
                    htmlFor="description"
                    className="text-base font-semibold"
                  >
                    NFT 描述
                  </Label>
                  <textarea
                    id="description"
                    placeholder="描述您的 NFT..."
                    value={nftDescription}
                    onChange={(e) => setNftDescription(e.target.value)}
                    className="w-full min-h-[120px] px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    添加关于这个 NFT 的详细介绍
                  </p>
                </div>

                {/* 接收地址 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="address" className="text-base font-semibold">
                      接收地址（可选）
                    </Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fillMyAddress}
                      className="text-xs text-primary hover:text-primary/80"
                    >
                      使用我的地址
                    </Button>
                  </div>
                  <Input
                    id="address"
                    type="text"
                    placeholder={`默认: ${address?.slice(0, 6)}...${address?.slice(-4)}`}
                    value={mintAddress}
                    onChange={(e) => setMintAddress(e.target.value)}
                    className="bg-background border-border h-12"
                  />
                  <p className="text-xs text-muted-foreground">
                    留空则铸造到当前钱包地址
                  </p>
                </div>

                {/* 当前步骤提示 */}
                {loading && currentStep && (
                  <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4">
                    <div className="flex items-center">
                      <Loader2 className="h-5 w-5 text-blue-500 mr-3 animate-spin flex-shrink-0" />
                      <p className="text-sm text-blue-500 font-medium">
                        {currentStep}
                      </p>
                    </div>
                  </div>
                )}

                {/* 错误信息 */}
                {error && (
                  <div className="bg-destructive/10 border border-destructive/50 rounded-lg p-4 flex items-start">
                    <XCircle className="h-5 w-5 text-destructive mr-3 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-destructive font-medium">
                        {error}
                      </p>
                    </div>
                  </div>
                )}

                {/* 成功信息 */}
                {success && (
                  <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4">
                    <div className="flex items-start">
                      <CheckCircle2 className="h-5 w-5 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm text-green-500 font-medium mb-3">
                          🎉 NFT 铸造成功！
                        </p>
                        
                        {tokenId && (
                          <div className="mb-3">
                            <p className="text-xs text-muted-foreground mb-1">
                              Token ID: <span className="font-mono font-semibold">{tokenId}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              合约地址: <span className="font-mono text-[10px]">0x8DE7E421...4664</span>
                            </p>
                          </div>
                        )}

                        {/* 操作按钮组 */}
                        <div className="flex flex-wrap gap-2 mb-3">
                          <Button
                            onClick={addNFTToWallet}
                            variant="outline"
                            size="sm"
                            className="text-xs h-8"
                          >
                            <Sparkles className="h-3 w-3 mr-1" />
                            添加到钱包
                          </Button>
                          
                          {txHash && (
                            <Button
                              onClick={() => window.open(`https://sepolia.etherscan.io/tx/${txHash}`, '_blank')}
                              variant="outline"
                              size="sm"
                              className="text-xs h-8"
                            >
                              查看交易
                            </Button>
                          )}
                          
                          {tokenId && (
                            <>
                              <Button
                                onClick={() => {location.href = `/portfolio`}}
                                variant="outline"
                                size="sm"
                                className="text-xs h-8"
                              >
                                在仓库查看
                              </Button>
                              
                              <Button
                                onClick={() => window.open(`https://sepolia.etherscan.io/token/0x8DE7E4217A1254B1bB1afC8F33Ba5d325BcA4664?a=${tokenId}`, '_blank')}
                                variant="outline"
                                size="sm"
                                className="text-xs h-8"
                              >
                                在 Etherscan 查看
                              </Button>
                            </>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground">
                          💡 提示：点击"添加到钱包"可将 NFT 导入到您的钱包中
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 按钮组 */}
                <div className="flex gap-4 pt-4">
                  <Button
                    onClick={handleMint}
                    disabled={loading}
                    className="flex-1 h-12 text-base font-semibold bg-primary hover:bg-primary/90"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        铸造中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-5 w-5" />
                        开始铸造
                      </>
                    )}
                  </Button>
                  {(success || error) && (
                    <Button
                      onClick={resetForm}
                      variant="outline"
                      className="h-12 text-base font-semibold"
                    >
                      重置
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 信息提示卡片 */}
          <div className="mt-8 bg-muted/30 border border-border rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-3">💡 铸造说明</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>
                  请确保您的钱包已连接到 Sepolia 测试网
                </span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>
                  上传的图片和 metadata 将自动存储到云端
                </span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>NFT 名称和描述将永久记录在区块链上</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>
                  铸造由后端服务处理，无需支付 Gas 费用
                </span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>
                  铸造完成后，您可以在 Portfolio 页面查看您的 NFT
                </span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>合约地址: 0x8DE7E4217A1254B1bB1afC8F33Ba5d325BcA4664</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

