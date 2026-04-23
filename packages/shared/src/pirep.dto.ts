import { z } from 'zod';

export const PirepDto = z.object({
    id: z.number(),
    userId: z.number(),
    airlineId: z.number(),
    departureAirport: z.string(),
    arrivalAirport: z.string(),
    flightNumber: z.string(),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export type PirepDtoType = z.infer<typeof PirepDto>;