import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
});

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const CreateRoomSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['council', 'one_on_one']),
  persona: z.string().optional(), // required when kind=one_on_one, validated server-side
});

export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  parentNodeId: z.string().uuid().optional(), // defaults to branch head
  branchId: z.string().uuid(),
});

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const CreateBranchSchema = z.object({
  name: z.string().min(1).max(100),
  fromNodeId: z.string().uuid(),
});

export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;
