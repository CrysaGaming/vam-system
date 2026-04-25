'use client';

import { BarChart } from '@/components/BarChart';

type DataPoint = {
  month: string;
  flights: number;
};

export function TestChart({ data }: { data: DataPoint[] }) {
  return (
    <BarChart
      data={data}
      index="month"
      categories={['flights']}
      colors={['blue']}
      yAxisWidth={48}
    />
  );
}