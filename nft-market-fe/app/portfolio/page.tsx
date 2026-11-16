"use client";

import { Sidebar } from "./components/sidebar";
import { MainContent } from "./components/main-content";
import activityApi from "@/api/activity";
import { request } from "@/api/request";
import { useAccount } from "wagmi";
import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { VAULT_CONTRACT_ADDRESS } from "@/contracts/service/orderBookContract";

const NFT_BALANCE_ABI = [
  "function NFTBalance(bytes32 orderKey) view returns (uint256)",
];

/**
 * 读取链上 Vault 的 NFTBalance，判断某个订单的 NFT 是否仍被托管。
 * 返回 tokenId（>0 表示仍在托管），0 表示已释放。
 */
async function readVaultNftBalance(
  signer: ethers.Signer | undefined,
  orderKey: string
): Promise<number> {
  if (!signer || !orderKey) return 0;
  try {
    const vault = new ethers.Contract(VAULT_CONTRACT_ADDRESS, NFT_BALANCE_ABI, signer);
    const bal = await vault.NFTBalance(orderKey);
    return Number(bal);
  } catch (err) {
    console.warn("读取 Vault.NFTBalance 失败", orderKey, err);
    return 0;
  }
}

export default function Home() {

  const { address: owner, chainId } = useAccount();
  const signer = useEthersSigner();
  const [myListOrders, setMyListOrders] = useState<any[]>([]);

  const loadMyListOrders = useCallback(async () => {
    if (!owner || !chainId) return;
    try {
      // 1) 历史：该用户所有 list 事件（含已取消/已成交）
      const historyResp: any = await activityApi.GetActivity({
        filter_ids: [chainId],
        collection_addresses: [],
        user_addresses: [owner],
        event_types: ["list"],
        page: 1,
        page_size: 100,
      });
      const history: any[] = historyResp?.result || [];

      // 2) 挂单：/portfolio/listings 带 orderKey，覆盖已过期但 NFT 仍在托管的订单
      const listingByKey = new Map<string, any>();
      try {
        const listingsResp: any = await request.get("/portfolio/listings", {
          params: {
            filters: JSON.stringify({
              chain_id: [chainId],
              collection_addresses: [],
              user_addresses: [owner],
              page: 1,
              page_size: 100,
            }),
          },
        });
        const listings = listingsResp?.result || listingsResp || [];
        for (const l of listings) {
          if (!l.list_order_id) continue;
          const k = `${String(l.collection_address).toLowerCase()}-${l.token_id}`;
          listingByKey.set(k, l);
        }
      } catch (err) {
        console.error("加载挂单列表失败:", err);
      }

      // 3) 活跃挂单（用于区分「正常挂单中」）
      let activeKeys = new Set<string>();
      try {
        const itemsResp: any = await request.get("/portfolio/items", {
          params: {
            filters: JSON.stringify({
              chain_id: [chainId],
              collection_addresses: [],
              user_addresses: [owner],
              page: 1,
              page_size: 100,
            }),
          },
        });
        const items = itemsResp?.result || itemsResp || [];
        activeKeys = new Set(
          items
            .filter((it: any) => it.list_order_id && it.list_order_id !== "")
            .map((it: any) => `${String(it.collection_address).toLowerCase()}-${it.token_id}`)
        );
      } catch (err) {
        console.error("加载活跃挂单失败:", err);
      }

      // 4) 按 NFT 汇总，同一 token 只保留最新一条挂单事件
      const latestByToken = new Map<string, any>();
      for (const ev of history) {
        const key = `${String(ev.collection_address).toLowerCase()}-${ev.token_id}`;
        const prev = latestByToken.get(key);
        if (!prev || Number(ev.event_time) > Number(prev.event_time)) {
          latestByToken.set(key, ev);
        }
      }
      // listings 里有、但 history 里没有的，也要补进来
      for (const [key, l] of listingByKey) {
        if (!latestByToken.has(key)) {
          latestByToken.set(key, {
            collection_address: l.collection_address,
            collection_name: l.collection_name,
            collection_image_uri: l.image_uri,
            token_id: l.token_id,
            item_name: l.name,
            image_uri: l.image_uri,
            price: l.list_price,
            event_time: l.list_time,
            maker: l.list_maker,
          });
        }
      }

      // 5) 逐条读取链上托管状态，决定能否撤单
      const merged = await Promise.all(
        Array.from(latestByToken.entries()).map(async ([key, ev]) => {
          const listing = listingByKey.get(key);
          const orderKey: string = listing?.list_order_id || "";
          const vaultTokenId = await readVaultNftBalance(signer, orderKey);

          // 仍在 Vault 托管 = 可以撤单取回
          const canCancel = vaultTokenId > 0;
          // 活跃挂单 = 正常挂单中（未过期、未成交）
          const isActive = activeKeys.has(key);

          let status: "active" | "expired" | "ended";
          if (canCancel && isActive) status = "active";
          else if (canCancel) status = "expired";   // 过期/失效，但 NFT 仍锁在 Vault
          else status = "ended";                    // 已取消或已成交，资产已释放

          return {
            ...ev,
            tokenId: ev.token_id,
            collectionAddress: ev.collection_address,
            name: ev.item_name || `${ev.collection_name || "NFT"} #${ev.token_id}`,
            image: ev.image_uri || ev.collection_image_uri || "",
            priceWei: listing?.list_price || ev.price,
            orderKey,
            status,
            isActive,
            canCancel,
            vaultTokenId,
          };
        })
      );

      // 可撤单的排最前，其次活跃，最后已结束；同类按时间倒序
      const rank = (s: string) => (s === "expired" ? 0 : s === "active" ? 1 : 2);
      merged.sort((a, b) => {
        const d = rank(a.status) - rank(b.status);
        if (d !== 0) return d;
        return Number(b.event_time) - Number(a.event_time);
      });

      setMyListOrders(merged);
    } catch (err) {
      console.error("加载挂单历史失败:", err);
    }
  }, [owner, chainId, signer]);

  useEffect(() => { loadMyListOrders(); }, [loadMyListOrders]);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex flex-1">
        <Sidebar />
        <MainContent myListOrders={myListOrders} onOrderChanged={loadMyListOrders} />
      </div>
    </div>
  );
}
