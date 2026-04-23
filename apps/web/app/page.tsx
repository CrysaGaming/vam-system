import { auth, signIn, signOut } from '@/auth';

export default async function Home() {
    const session = await auth();

    return (
        <main className="min-h-screen flex items-center justify-center">
            <div className="text-center space-y-4">
                <h1 className="text-3xl font-bold">VAM System</h1>
                {session?.user ? (
                    <div className="space-y-2">
                        <p>Hallo, {session.user.name}!</p>
                        <form action={async () => { 'use server'; await signOut(); }}>
                            <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded">
                                Abmelden
                            </button>
                        </form>
                    </div>
                ) : (
                    <form action={async () => { 'use server'; await signIn('discord'); }}>
                        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded">
                            Mit Discord anmelden
                        </button>
                    </form>
                )}
            </div>
        </main>
    );
}
