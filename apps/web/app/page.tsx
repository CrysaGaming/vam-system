import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">VAM System</h1>
        <p className="text-gray-400 text-lg">
          Virtual Airline Management — modular, modern, open-source.
        </p>
        <form action={async () => { 'use server'; await signIn('discord', { redirectTo: '/dashboard' }); }}>
          <button
            type="submit"
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium text-lg transition shadow-lg hover:shadow-indigo-500/30"
          >
            Mit Discord anmelden
          </button>
        </form>
      </div>
    </main>
  );
}
