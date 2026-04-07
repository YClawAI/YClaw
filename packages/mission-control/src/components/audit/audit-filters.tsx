'use client';

import { useState } from 'react';
import type { AuditFilters as FiltersType, AuditEventType } from './audit-types';
import { AUDIT_TYPE_CONFIG } from './audit-types';

interface AuditFiltersProps {
  filters: FiltersType;
  onChange: (filters: FiltersType) => void;
}

const TIME_RANGES: Array<{ value: FiltersType['timeRange']; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

export function AuditFilterBar({ filters, onChange }: AuditFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search);

  const toggleType = (type: AuditEventType) => {
    const types = filters.types.includes(type)
      ? filters.types.filter(t => t !== type)
      : [...filters.types, type];
    onChange({ ...filters, types });
  };

  const handleSearch = () => {
    onChange({ ...filters, search: searchInput });
  };

  return (
    <div className="px-4 py-3 border-b border-gray-800 space-y-2">
      {/* Time range + search */}
      <div className="flex items-center gap-1">
        {TIME_RANGES.map(tr => (
          <button
            key={tr.value}
            onClick={() => onChange({ ...filters, timeRange: tr.value })}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              filters.timeRange === tr.value
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {tr.label}
          </button>
        ))}

        <div className="flex-1 ml-2">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search events..."
            className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded-md text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-500"
          />
        </div>
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1">
        {(Object.entries(AUDIT_TYPE_CONFIG) as Array<[AuditEventType, (typeof AUDIT_TYPE_CONFIG)[AuditEventType]]>).map(
          ([type, config]) => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full transition-colors ${
                filters.types.length === 0 || filters.types.includes(type)
                  ? 'bg-gray-700/60 text-gray-200'
                  : 'bg-gray-800/40 text-gray-500'
              }`}
            >
              <span>{config.icon}</span>
              <span>{config.label}</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
