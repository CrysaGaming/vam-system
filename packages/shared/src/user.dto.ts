import { z } from 'zod';

export const UserDto = z.object({
    id: z.number(),
    email: z.string().email(),
    name: z.string().nullable(),
    airlineId: z.number().nullable(),
    rankId: z.number().nullable(),
    roleId: z.number().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export type UserDtoType = z.infer<typeof UserDto>;