import { z } from 'zod';
import {
  ActorType,
  AdapterType,
  ActorAvailability,
  AutonomyLevel,
} from '../core';

export interface ActorConfig {
  id: string;
  name: string;
  type: ActorType | string;
  adapter: AdapterType | string;
  capabilities: string[];
  model?: string;
  availability: ActorAvailability | string;
  autonomyLevel: AutonomyLevel | string;
  owner?: string;
  config: Record<string, any>;
}

/**
 * Actor Configuration Schema
 */
export const ActorConfigSchema = z
  .object({
    id: z.string().min(1, 'Actor id cannot be empty'),
    name: z.string().min(1, 'Actor name cannot be empty'),
    type: z
      .nativeEnum(ActorType)
      .or(z.string())
      .default(ActorType.INTERNAL_AGENT),
    adapter: z
      .nativeEnum(AdapterType)
      .or(z.string())
      .default(AdapterType.CLI),
    adapterType: z
      .nativeEnum(AdapterType)
      .or(z.string())
      .optional(),
    capabilities: z.array(z.string()).nullish().transform((v) => v ?? []),
    model: z.string().optional(),
    availability: z
      .nativeEnum(ActorAvailability)
      .or(z.string())
      .default(ActorAvailability.AVAILABLE),
    autonomyLevel: z
      .nativeEnum(AutonomyLevel)
      .or(z.string())
      .optional(),
    autonomy: z
      .nativeEnum(AutonomyLevel)
      .or(z.string())
      .optional(),
    owner: z.string().optional(),
    config: z.record(z.any()).nullish().transform((v) => v ?? {}),
  })
  .transform((data): ActorConfig => {
    const adapter = (data.adapterType || data.adapter || AdapterType.CLI) as AdapterType | string;
    const autonomyLevel = (data.autonomyLevel || data.autonomy || AutonomyLevel.SEMI_AUTONOMOUS) as AutonomyLevel | string;
    const result: ActorConfig = {
      id: data.id,
      name: data.name,
      type: data.type as ActorType | string,
      adapter,
      capabilities: data.capabilities,
      availability: data.availability as ActorAvailability | string,
      autonomyLevel,
      config: data.config,
    };
    if (data.model !== undefined) result.model = data.model;
    if (data.owner !== undefined) result.owner = data.owner;
    return result;
  });

/**
 * Policy Configuration Schema
 */
export const PolicyConfigSchema = z.object({
  defaultAutonomy: z
    .nativeEnum(AutonomyLevel)
    .or(z.string())
    .default(AutonomyLevel.SEMI_AUTONOMOUS),
  requireApproval: z.boolean().default(true),
  timeoutSeconds: z.number().positive().default(300),
  maxRetries: z.number().nonnegative().default(1),
  autoFallback: z.boolean().default(true),
  testCommand: z.string().optional(),
  skipTests: z.boolean().default(false),
  defaultImplementer: z.string().default('opencode'),
  defaultReviewer: z.string().default('claude'),
  customPolicies: z.record(z.any()).nullish().transform((v) => v ?? {}),
});

/**
 * Workflow Stage Schema
 */
export const WorkflowStageSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Stage name cannot be empty'),
  actor: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  gate: z.string().optional(),
  required: z.boolean().default(true),
  timeoutSeconds: z.number().positive().optional(),
  config: z.record(z.any()).nullish().transform((v) => v ?? {}),
});

export interface FactoryConfig {
  name: string;
  version: string;
  description?: string;
  repository?: string;
  defaultBranch: string;
  metadata?: Record<string, any>;
  actors: ActorConfig[];
  policies: PolicyConfig;
  stages: WorkflowStage[];
}

/**
 * Root Factory Configuration Schema (factory.yaml)
 */
export const FactoryConfigSchema = z
  .object({
    name: z.string().default('software-factory'),
    version: z.string().default('1.0.0'),
    description: z.string().optional(),
    repository: z.string().optional(),
    defaultBranch: z.string().default('main'),
    metadata: z.record(z.any()).optional().default({}),
    actors: z.array(ActorConfigSchema).nullish().transform((v) => v ?? []),
    policies: PolicyConfigSchema.default({}),
    stages: z.array(WorkflowStageSchema).optional(),
    workflows: z.array(WorkflowStageSchema).optional(),
  })
  .transform((data): FactoryConfig => {
    const resolvedStages =
      data.stages && data.stages.length > 0
        ? data.stages
        : (data.workflows || []);

    const result: FactoryConfig = {
      name: data.name,
      version: data.version,
      defaultBranch: data.defaultBranch,
      actors: data.actors,
      policies: data.policies,
      stages: resolvedStages,
    };
    if (data.description !== undefined) result.description = data.description;
    if (data.repository !== undefined) result.repository = data.repository;
    if (data.metadata !== undefined) result.metadata = data.metadata;
    return result;
  });

// export type ActorConfig is already defined above
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;
// export type FactoryConfig is already defined above
