import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export interface AsciiHeaderProfile {
  name: string;
  pokemon_type: string;
  evolution_stage: string;
  active_tasks: { id: string; title: string; status: string }[];
}

export interface AsciiHeaderState {
  unread_total: number;
}

export function loadAsciiHeader(
  vaultPath: string,
  profile: AsciiHeaderProfile,
  state: AsciiHeaderState
): string | undefined {
  const spritePath = join(vaultPath, "_index", "sprites", `${profile.name.toLowerCase()}.txt`);
  if (!existsSync(spritePath)) return undefined;
  const sprite = readFileSync(spritePath, "utf8");
  const spriteLines = sprite.split("\n").filter(l => l.length > 0).slice(0, 3);
  while (spriteLines.length < 3) spriteLines.push("");
  const titleName = profile.name.charAt(0).toUpperCase() + profile.name.slice(1);
  const summaryLine1 = `${titleName} · ${profile.evolution_stage} · ${profile.pokemon_type}`;
  const taskCount = profile.active_tasks.length;
  const summaryLine2 = `${taskCount} task${taskCount === 1 ? "" : "s"} active · ${state.unread_total} unread on declared channels`;
  const PAD = 12;
  const padded = spriteLines.map(l => l.padEnd(PAD, " "));
  return [
    padded[0],
    `${padded[1]}    ${summaryLine1}`,
    `${padded[2]}    ${summaryLine2}`
  ].join("\n");
}
