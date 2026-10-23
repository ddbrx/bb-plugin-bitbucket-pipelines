import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const slug = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_.-]+$/).refine(v => v !== '.' && v !== '..');
export const repositoryInput = z.object({ workspace: slug.optional(), repo: slug.optional() }).strict();
export const listInput = repositoryInput.extend({ page: z.number().int().min(1).max(10000).default(1) });
export const runInput = repositoryInput.extend({
  ref: z.string().trim().min(1).max(256),
  refType: z.enum(['branch', 'tag']).default('branch'),
  custom: z.string().trim().min(1).max(256).optional(),
  commit: z.string().regex(/^[a-fA-F0-9]{7,40}$/).optional(),
  variables: z.array(z.object({ key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(256), value: z.string().max(10000), secured: z.boolean().default(true) }).strict()).max(50).default([]),
}).refine(v => new Set(v.variables.map(x => x.key)).size === v.variables.length, 'Variable keys must be unique');
export const pipelineInput = repositoryInput.extend({ uuid: z.string().regex(/^(?:\{[a-fA-F0-9-]{36}\}|[a-fA-F0-9-]{36}|[0-9]+)$/) });
export const pipelineSchema = z.object({
  uuid: z.string(), number: z.number(), state: z.string(), result: z.string().nullable(),
  ref: z.string(), custom: z.string().nullable(), commit: z.string(), creator: z.string(),
  created: z.string(), completed: z.string().nullable(), duration: z.number(), url: z.string(),
});
export type Pipeline = z.infer<typeof pipelineSchema>;
export const stepSchema = z.object({ uuid: z.string(), name: z.string(), state: z.string(), result: z.string().nullable(), duration: z.number() });
export const rpcContract = defineRpcContract({
  saveRepository: { input: repositoryInput.required(), output: repositoryInput.required() },
  config: { input: z.null(), output: z.object({ configured: z.boolean(), workspace: z.string(), repo: z.string() }) },
  list: { input: listInput, output: z.object({ pipelines: z.array(pipelineSchema), hasNext: z.boolean(), page: z.number() }) },
  run: { input: runInput, output: pipelineSchema },
  get: { input: pipelineInput, output: pipelineSchema },
  steps: { input: pipelineInput, output: z.object({ steps: z.array(stepSchema) }) },
  stop: { input: pipelineInput, output: z.object({ stopped: z.boolean() }) },
});
