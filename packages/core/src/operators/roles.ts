import { z } from 'zod';
import type { Db, Collection, Filter } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('operator-roles');

// ─── Role Schema ───────────────────────────────────────────────────────────────

export const GrantSchema = z.object({
  resourceType: z.enum(['department', 'agent', 'task', 'operator', 'audit']),
  resourceId: z.string(),
  actions: z.array(z.string()),
});

export type Grant = z.infer<typeof GrantSchema>;

export const RoleSchema = z.object({
  roleId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  grants: z.array(GrantSchema),
  priorityClass: z.number().default(50),
  canManageOperators: z.boolean().default(false),
  canApproveDeployments: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Role = z.infer<typeof RoleSchema>;

// ─── Default Roles ─────────────────────────────────────────────────────────────

const now = () => new Date();

export const DEFAULT_ROLES: Role[] = [
  {
    roleId: 'role_ceo',
    name: 'CEO / Org Admin',
    description: 'Full access to all departments and agents',
    grants: [{ resourceType: 'department', resourceId: '*', actions: ['*'] }],
    priorityClass: 100,
    canManageOperators: true,
    canApproveDeployments: true,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    roleId: 'role_department_head',
    name: 'Department Head',
    description: 'Full access to assigned departments',
    grants: [],
    priorityClass: 70,
    canManageOperators: false,
    canApproveDeployments: false,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    roleId: 'role_contributor',
    name: 'Contributor',
    description: 'Can trigger tasks and read data in assigned departments',
    grants: [],
    priorityClass: 50,
    canManageOperators: false,
    canApproveDeployments: false,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    roleId: 'role_observer',
    name: 'Observer',
    description: 'Read-only access to assigned departments',
    grants: [],
    priorityClass: 10,
    canManageOperators: false,
    canApproveDeployments: false,
    createdAt: now(),
    updatedAt: now(),
  },
];

// ─── Role Store ────────────────────────────────────────────────────────────────

export class RoleStore {
  private readonly collection: Collection<Role>;

  constructor(db: Db) {
    this.collection = db.collection<Role>('roles');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ roleId: 1 }, { unique: true });
    logger.info('Role store indexes ensured');
  }

  async seedDefaults(): Promise<void> {
    for (const role of DEFAULT_ROLES) {
      await this.collection.updateOne(
        { roleId: role.roleId } as Filter<Role>,
        { $setOnInsert: role },
        { upsert: true },
      );
    }
    logger.info(`Default roles seeded (${DEFAULT_ROLES.length} roles)`);
  }

  async getByRoleId(roleId: string): Promise<Role | null> {
    return this.collection.findOne({ roleId } as Filter<Role>) as Promise<Role | null>;
  }

  async getRoleForTier(tier: string): Promise<Role | null> {
    const mapping: Record<string, string> = {
      root: 'role_ceo',
      department_head: 'role_department_head',
      contributor: 'role_contributor',
      observer: 'role_observer',
    };
    const roleId = mapping[tier];
    if (!roleId) return null;
    return this.getByRoleId(roleId);
  }

  async listRoles(): Promise<Role[]> {
    return this.collection.find({}).toArray() as Promise<Role[]>;
  }
}
