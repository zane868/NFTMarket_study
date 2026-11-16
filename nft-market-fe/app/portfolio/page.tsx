"use client";

import { Sidebar } from "./components/sidebar";
import { MainContent } from "./components/main-content";
import activityApi from "@/api/activity";
import { request } from "@/api/request";
import { useAccount } from "wagmi";
import { useEffect, useState, useCallback } from "react";

export default function Home() {

  const { address: owner, chainId } = useAccount();
  const [myListOrders, setMyListOrders] = useState<any[]>([]);

  const loadMyListOrders = useCallback(async () => {
    if (!owner || !chainId) return;
    try {
      // 1) 历史：拉取该用户所有 list 事件（含已取消/已成交的挂单）
      const filters = JSON.stringify({
        filter_ids: [chainId],
        collection_addresses: [],
        user_addresses: [owner],
        event_types: ["list"],
        page: 1,
        page_size: 100,
      });
      const resp: any = await activityApi.GetActivity(JSON.parse(filters));
      const history: any[] = resp?.result || [];

      // 2) 当前：从 portfolio/items 取得仍活跃的挂单，用于标注状态
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
        console.error("加载活跃挂单失败，状态将全部标记为已结束:", err);
      }

      // 3) 按 NFT 汇总：同一 token 多次挂单只保留最新一次
      const latestByToken = new Map<string, any>();
      for (const ev of history) {
        const key = `${String(ev.collection_address).toLowerCase()}-${ev.token_id}`;
        const prev = latestByToken.get(key);
        if (!prev || Number(ev.event_time) > Number(prev.event_time)) {
          latestByToken.set(key, ev);
        }
      }

      const merged = Array.from(latestByToken.entries()).map(([key, ev]) => ({
        ...ev,
        tokenId: ev.token_id,
        collectionAddress: ev.collection_address,
        name: ev.item_name || `${ev.collection_name || "NFT"} #${ev.token_id}`,
        image: ev.image_uri || ev.collection_image_uri || "",
        priceWei: ev.price,
        // 仍在 items 里出现说明当前仍然活跃
        isActive: activeKeys.has(key),
      }));

      // 活跃的排前面，其次按时间倒序
      merged.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return Number(b.event_time) - Number(a.event_time);
      });

      setMyListOrders(merged);
    } catch (err) {
      console.error("加载挂单历史失败:", err);
    }
  }, [owner, chainId]);

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
