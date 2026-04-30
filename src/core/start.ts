import { tailChannel } from "./channel.js";

export interface ChannelActivity {
  channel: string;
  unread_count: number;
  last_entry_summary: string;
}

export interface ComputeChannelActivityOptions {
  since?: string;
  wiki?: string;
  summaryLength?: number;
}

const DEFAULT_SUMMARY_LENGTH = 120;

export function computeChannelActivity(
  vaultPath: string,
  channels: string[],
  opts: ComputeChannelActivityOptions = {}
): ChannelActivity[] {
  const summaryLength = opts.summaryLength ?? DEFAULT_SUMMARY_LENGTH;
  return channels.map(channel => {
    const { entries } = tailChannel(vaultPath, {
      channel,
      since: opts.since,
      wiki: opts.wiki
    });
    const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
    return {
      channel,
      unread_count: entries.length,
      last_entry_summary: last ? last.body.slice(0, summaryLength) : ""
    };
  });
}
