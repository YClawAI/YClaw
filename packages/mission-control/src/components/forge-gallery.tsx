'use client';

export type ForgeAsset = {
  id: string;
  name: string;
  status: string;
  model?: string;
  dimensions?: string;
  requestedBy?: string;
};

export type ForgeRequest = {
  id: string;
  description: string;
  requestedBy?: string;
  priority?: string;
  createdAt?: string;
};

interface ForgeGalleryProps {
  assets: ForgeAsset[];
  requests: ForgeRequest[];
}

function formatTimeAgo(iso?: string): string {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function assetStatusBadge(status: string): string {
  switch (status) {
    case 'rendering': return 'bg-mc-warning/10 border-mc-warning/30 text-mc-warning';
    case 'ready': return 'bg-mc-success/10 border-mc-success/30 text-mc-success';
    case 'failed': return 'bg-mc-danger/10 border-mc-danger/30 text-mc-danger';
    case 'published': return 'bg-mc-info/10 border-mc-info/30 text-mc-info';
    default: return 'bg-mc-border border-mc-border text-mc-text-tertiary';
  }
}

function priorityColor(priority?: string): string {
  switch (priority) {
    case 'high': return 'text-mc-danger';
    case 'medium': return 'text-mc-warning';
    case 'low': return 'text-mc-text-tertiary';
    default: return 'text-mc-text-tertiary';
  }
}

function AssetCard({ asset }: { asset: ForgeAsset }) {
  return (
    <div className="bg-mc-surface-hover border border-mc-border rounded overflow-hidden">
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="text-xs text-mc-text font-mono truncate flex-1" title={asset.name}>
            {asset.name}
          </div>
          <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold border rounded whitespace-nowrap ${assetStatusBadge(asset.status)}`}>
            {asset.status.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center justify-between text-[10px] text-mc-text-tertiary font-mono">
          {asset.model && <span>{asset.model}</span>}
          {asset.dimensions && <span>{asset.dimensions}</span>}
        </div>
        {asset.requestedBy && (
          <div className="text-[10px] text-mc-text-tertiary font-mono mt-1">
            {asset.requestedBy}
          </div>
        )}
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  return (
    <span className={`text-[10px] font-mono font-bold uppercase ${priorityColor(priority)}`}>
      [{priority ?? 'normal'}]
    </span>
  );
}

export function ForgeGallery({ assets, requests }: ForgeGalleryProps) {
  if (assets.length === 0 && requests.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-mc-text-tertiary">No assets generated</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Asset Gallery */}
      <div>
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
          RECENT OUTPUTS
        </div>
        {assets.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-xs text-mc-text-tertiary">No assets generated</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        )}
      </div>

      {/* Pending Requests Queue */}
      <div>
        <div className="text-xs font-bold uppercase tracking-widest text-mc-text-tertiary mb-3">
          PENDING REQUESTS
          <span className="ml-2 text-mc-blocked">{requests.length}</span>
        </div>
        <div className="bg-mc-surface-hover border border-mc-border rounded divide-y divide-mc-border">
          {requests.length === 0 ? (
            <div className="p-4 text-xs text-mc-text-tertiary text-center font-mono">
              No pending asset requests.
            </div>
          ) : (
            requests.map((req) => (
              <div key={req.id} className="px-4 py-3 flex items-start gap-3">
                <PriorityBadge priority={req.priority} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-mc-text font-mono">{req.description}</div>
                  <div className="text-[10px] text-mc-text-tertiary font-mono mt-0.5">
                    {req.requestedBy ? `from ${req.requestedBy}` : ''}{req.requestedBy && req.createdAt ? ' \u00b7 ' : ''}{req.createdAt ? formatTimeAgo(req.createdAt) : ''}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
