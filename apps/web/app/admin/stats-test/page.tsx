import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import { TestChart } from './test-chart';

const ALLOWED_ROLES = ['admin', 'instructor'];

export default async function StatsTest() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || !ALLOWED_ROLES.includes(user.role.name)) {
    redirect('/dashboard');
  }

  // Test-Daten
  const data = [
    { month: 'Jan', flights: 4 },
    { month: 'Feb', flights: 7 },
    { month: 'Mar', flights: 12 },
    { month: 'Apr', flights: 8 },
  ];

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Tremor Raw Test</h1>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Flüge pro Monat (Test)
          </h2>
          <TestChart data={data} />
        </div>
      </div>
    </main>
  );
}