"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Gavel } from "lucide-react"
import { useAccount } from "wagmi"
import { ItemsGrid } from "./items-grid"
import { TradingView } from "./trading-view"
import { RecentActivity } from "./recent-activity"
import { PlaceBidDialog } from "./place-bid-dialog"
import { CollectionBidsPanel } from "./collection-bids-panel"

interface CollectionViewProps {
  items?: any[]
  chainId?: string | number
  collectionAddress?: string
}

export function CollectionView({ items = [], chainId, collectionAddress }: CollectionViewProps) {
  const { isConnected } = useAccount()
  const [bidOpen, setBidOpen] = useState(false)
  // 出价成功后递增，触发合集买单列表重新拉取
  const [bidsRefreshKey, setBidsRefreshKey] = useState(0)

  return (
    <div className="container mx-auto px-4 py-6">
      {/* 合集级操作条 */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          对整份合集出价：设定单价与数量，可匹配该合集内任意 NFT。
        </div>
        <Button
          onClick={() => setBidOpen(true)}
          disabled={!isConnected || !collectionAddress}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Gavel className="h-4 w-4 mr-2" />
          合集出价
        </Button>
      </div>

      {bidOpen && collectionAddress && (
        <PlaceBidDialog
          open={bidOpen}
          close={() => setBidOpen(false)}
          collectionAddress={collectionAddress}
          onPlaced={() => {
            // 链上事件到入库有延迟，先立即刷一次，再延时补一次
            setBidsRefreshKey((k) => k + 1)
            setTimeout(() => setBidsRefreshKey((k) => k + 1), 8000)
          }}
        />
      )}

      <Tabs defaultIndex={0} className="space-y-4">
        <TabsContent>
          <div className="grid grid-cols-[1fr_300px] gap-6">
            <div className="min-h-[400px]">
              <ItemsGrid items={items} chainId={chainId} />
            </div>
            <div className="space-y-6">
              {collectionAddress && (
                <CollectionBidsPanel
                  collectionAddress={collectionAddress}
                  chainId={chainId ?? 11155111}
                  refreshKey={bidsRefreshKey}
                />
              )}
              <RecentActivity />
            </div>
          </div>
          <TradingView />
        </TabsContent>
        <TabsContent>{/* 活动内容 */}</TabsContent>
        <TabsContent>{/* 分析内容 */}</TabsContent>
      </Tabs>
    </div>
  )
}
