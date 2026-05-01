import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { listRoles } from './actions';
import { RoleManagement } from './role-management';

/**
 * Role-Management admin page. Hard-gated to role.name === 'admin' — see
 * actions.ts requireAdmin for the server-side guard. The redirect here is
 * defense-in-depth: even if a non-admin somehow loaded this page, the
 * server actions would still reject any mutation.
 */
export default async function AdminRolesPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    redirect('/dashboard');
  }

  const roles = await listRoles();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Rollen-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Globale Rollen + Permissions. Admin-only.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <RoleManagement roles={roles} />
      </div>
    </main>
  );
}
