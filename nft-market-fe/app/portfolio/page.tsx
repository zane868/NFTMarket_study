"use client";

import { Sidebar } from "./components/sidebar";
import { MainContent } from "./components/main-content";
import { request } from "@/api/request";
import { useAccount } from "wagmi";
import { useEffect, useState, useCallback } from "react";

export default function Home() {

  const { address: owner, chainId } = useAccount();
  const [myListOrders, setMyListOrders] = useState<any[]>([]);

  const loadMyListOrders = useCallback(async () => {
    if (!owner || !chainId) return;
    try {
      const filters = JSON.stringify({ chain_id: [chainId], user_addresses: [owner], page: 1, page_size: 50 });
      const resp: any = await request.get("/portfolio/items", { params: { filters } });
      const items = resp?.result || resp || [];
      setMyListOrders(items.filter((it: any) => it.list_order_id && it.list_order_id !== ""));
    } catch (err) { console.error("加载挂单失败:", err); }
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
