// src/tools/stadium-scopes.test.ts
// Verifies scope declarations for all 12 stadium tools.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { trainerInitTool } from './trainer-init.js';
import { profileRegisterTool } from './profile-register.js';
import { realSkillTool } from './real-skill.js';
import { moveFuseTool } from './move-fuse.js';
import { telemetryPushTool } from './telemetry-push.js';
import { trainerQueueMatchTool } from './trainer-queue-match.js';
import { trainerAcceptMatchTool } from './trainer-accept-match.js';
import { trainerGetStateTool } from './trainer-get-state.js';
import { trainerSubmitTool } from './trainer-submit.js';
import { matchWatchTool } from './match-watch.js';
import type { ToolScope } from '../auth/types.js';

// Helper: assert that a value conforms to ToolScope at the type level
// and return it so we can call the functions
function asScope(s: unknown): ToolScope {
  if (typeof s !== 'object' || s === null) {
    throw new Error('scope is not an object');
  }
  const scope = s as ToolScope;
  if (typeof scope.axis !== 'function') {
    throw new Error('scope.axis is not a function');
  }
  return scope;
}

describe('stadium tools — scope declarations', () => {
  describe('adminOnly registration/fusion/refresh tools', () => {
    const adminTools = [
      { name: 'vault_trainer-init', tool: trainerInitTool },
      { name: 'vault_profile-register', tool: profileRegisterTool },
      { name: 'vault_real-skill', tool: realSkillTool },
      { name: 'vault_move-fuse', tool: moveFuseTool },
    ];

    for (const { name, tool } of adminTools) {
      it(`${name} has scope with axis "stadium"`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({})).toBe('stadium');
      });

      it(`${name} has adminOnly: () => true`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.adminOnly).toBeDefined();
        expect(scope.adminOnly!({})).toBe(true);
      });
    }
  });

  describe('telemetry-push', () => {
    it('has scope with axis derived from wiki', () => {
      const scope = asScope((telemetryPushTool as any).scope);
      expect(scope.axis({ wiki: 'myteam' })).toBe('wikis/myteam');
    });

    it('telemetry-push axis falls back to "*" when wiki is absent', () => {
      const scope = asScope((telemetryPushTool as any).scope);
      expect(scope.axis({})).toBe('wikis/*');
    });

    it('telemetry-push has no adminOnly', () => {
      const scope = asScope((telemetryPushTool as any).scope);
      expect(scope.adminOnly).toBeUndefined();
    });

    it('telemetry-push inputSchema accepts and preserves optional wiki field', () => {
      const schema = (telemetryPushTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        real_skill_id: 'skill-abc',
        source: 'journal',
        reference_link: 'https://example.com',
        wiki: 'myteam',
      });
      expect(result.success).toBe(true);
      expect(result.data?.wiki).toBe('myteam');
    });

    it('telemetry-push inputSchema accepts input without wiki (wiki is optional)', () => {
      const schema = (telemetryPushTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        real_skill_id: 'skill-abc',
        source: 'journal',
        reference_link: 'https://example.com',
      });
      expect(result.success).toBe(true);
      expect(result.data?.wiki).toBeUndefined();
    });

    it('telemetry-push inputSchema rejects empty-string wiki', () => {
      const schema = (telemetryPushTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        real_skill_id: 'skill-abc',
        source: 'journal',
        reference_link: 'https://example.com',
        wiki: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('trainer-id axis tools', () => {
    const trainerTools = [
      { name: 'vault_trainer-queue-match', tool: trainerQueueMatchTool },
      { name: 'vault_trainer-accept-match', tool: trainerAcceptMatchTool },
      { name: 'vault_trainer-get-state', tool: trainerGetStateTool },
    ];

    for (const { name, tool } of trainerTools) {
      it(`${name} axis includes trainer_id when provided`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({ trainer_id: 'abc123' })).toBe('trainers/abc123');
      });

      it(`${name} axis falls back to "*" when trainer_id absent`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({})).toBe('trainers/*');
      });
    }

    it('trainer-queue-match inputSchema accepts and preserves optional trainer_id field', () => {
      const schema = (trainerQueueMatchTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        opponent_trainer_id: 'opp-001',
        trainer_id: 'me-trainer-id',
      });
      expect(result.success).toBe(true);
      expect(result.data?.trainer_id).toBe('me-trainer-id');
    });

    it('trainer-accept-match inputSchema accepts and preserves optional trainer_id field', () => {
      const schema = (trainerAcceptMatchTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        match_id: 'MATCH01234567890123456789',
        trainer_id: 'me-trainer-id',
      });
      expect(result.success).toBe(true);
      expect(result.data?.trainer_id).toBe('me-trainer-id');
    });

    it('trainer-get-state inputSchema accepts and preserves optional trainer_id field', () => {
      const schema = (trainerGetStateTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        match_id: 'MATCH01234567890123456789',
        trainer_id: 'me-trainer-id',
      });
      expect(result.success).toBe(true);
      expect(result.data?.trainer_id).toBe('me-trainer-id');
    });

    it('trainer-queue-match inputSchema accepts input without trainer_id (field is optional)', () => {
      const schema = (trainerQueueMatchTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        opponent_trainer_id: 'opp-001',
      });
      expect(result.success).toBe(true);
      expect(result.data?.trainer_id).toBeUndefined();
    });

    it('trainer-queue-match inputSchema rejects empty-string trainer_id', () => {
      const schema = (trainerQueueMatchTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        opponent_trainer_id: 'opp-001',
        trainer_id: '',
      });
      expect(result.success).toBe(false);
    });

    it('trainer-accept-match inputSchema rejects empty-string trainer_id', () => {
      const schema = (trainerAcceptMatchTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        match_id: 'MATCH01234567890123456789',
        trainer_id: '',
      });
      expect(result.success).toBe(false);
    });

    it('trainer-get-state inputSchema rejects empty-string trainer_id', () => {
      const schema = (trainerGetStateTool as any).inputSchema as z.ZodTypeAny;
      const result = schema.safeParse({
        match_id: 'MATCH01234567890123456789',
        trainer_id: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('match-id axis tools', () => {
    const matchTools = [
      { name: 'vault_trainer-submit', tool: trainerSubmitTool },
      { name: 'vault_match-watch', tool: matchWatchTool },
    ];

    for (const { name, tool } of matchTools) {
      it(`${name} axis includes match_id when provided`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({ match_id: 'MATCH01234567890123456789' })).toBe('matches/MATCH01234567890123456789');
      });

      it(`${name} axis falls back to "*" when match_id absent`, () => {
        const scope = asScope((tool as any).scope);
        expect(scope.axis({})).toBe('matches/*');
      });
    }
  });

  describe('consolidated vault_real-skill scope (modes: register | refresh)', () => {
    it('vault_real-skill has scope axis "stadium"', () => {
      const scope = asScope((realSkillTool as any).scope);
      expect(scope.axis({})).toBe('stadium');
    });

    it('vault_real-skill is adminOnly', () => {
      const scope = asScope((realSkillTool as any).scope);
      expect(scope.adminOnly).toBeDefined();
      expect(scope.adminOnly!({})).toBe(true);
    });
  });

  describe('consolidated vault_trainer-submit scope (modes: draft | move)', () => {
    it('vault_trainer-submit axis includes match_id when provided', () => {
      const scope = asScope((trainerSubmitTool as any).scope);
      expect(scope.axis({ match_id: 'MATCH01234567890123456789' })).toBe('matches/MATCH01234567890123456789');
    });

    it('vault_trainer-submit axis falls back to "*" when match_id absent', () => {
      const scope = asScope((trainerSubmitTool as any).scope);
      expect(scope.axis({})).toBe('matches/*');
    });
  });
});
