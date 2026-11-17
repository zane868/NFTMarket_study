"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import collectionApi from "@/api/collections";

const ETH_DECIMALS = 18;

interface CollectionBidsPanelProps {
  collectionAddress: string;
  chainId: string | number;
  /** 出价成功后由父组件递增，用于触发重新拉取 */
  refreshKey?: number;
}

function formatEth(value: string | number): string {
  if (!value || value === "0") return "-";
  try {
    const n = parseFloat(formatUnits(String(value), ETH_DECIMALS));
    if (n === 0) return "-";
    if (n >= 1) return `${n.toFixed(4)} ETH`;
    if (n >= 0.01) return `${n.toFixed(6)} ETH`;
    return `${n.toFixed(8)} ETH`;
  } catch {
    return "-";
  }
}

/**
 * 合集买单列表：展示该合集下按价格档聚合的出价。
 * 数据来自 /collections/:address/bids，按 order_type=CollectionBidOrder 分组统计。
 */
export function CollectionBidsPanel({
  collectionAddress,
  chainId,
  refreshKey = 0,
}: CollectionBidsPanelProps) {
  const { address } = useAccount();
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!collectionAddress) return;
    setLoading(true);
    setError("");
    try {
      const res: any = await collectionApi.GetCollectionBids({
        address: collectionAddress,
        chain_id: chainId,
        page: 1,
        page_size: 10,
      });
      const result = res?.result ?? res;
      setBids(Array.isArray(result) ? result : []);
    } catch (err: any) {
      setError(err?.message || "加载合集出价失败");
      setBids([]);
    } finally {
      setLoading(false);
    }
  }, [collectionAddress, chainId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">合集出价</span>
          {bids.length > 0 && (
            <span className="text-xs bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded">
              {bids.length} 档
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? "刷新中..." : "刷新"}
        </Button>
      </div>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      {bids.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {loading ? "加载中..." : "暂无合集出价。点击上方「合集出价」创建第一笔。"}
        </p>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground px-2 pb-1 border-b border-border">
            <span>单价</span>
            <span className="text-right">数量</span>
            <span className="text-right">总额</span>
            <span className="text-right">出价人</span>
          </div>
          {bids.map((bid, i) => (
            <div
              key={`${bid.price}-${i}`}
              className="grid grid-cols-4 gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted/50"
            >
              <span className="font-medium text-blue-400">{formatEth(bid.price)}</span>
              <span className="text-right">{bid.size ?? "-"}</span>
              <span className="text-right">{formatEth(bid.total)}</span>
              <span className="text-right text-muted-foreground">
                {bid.bidders ?? "-"}
              </span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2">
            出价人列是不同地址数；数量为未成交的剩余件数。
          </p>
        </div>
      )}

      {!address && (
        <p className="text-xs text-muted-foreground mt-2">
          连接钱包后可创建合集出价。
        </p>
      )}
    </div>
  );
}
