import Link from "next/link";
import { listPilotUsers } from "../../lib/pilotStore";

export const dynamic = "force-dynamic";

type Props = { searchParams: { k?: string } };

export default async function PilotAdminPage({ searchParams }: Props) {
  const key = searchParams?.k || "";
  const expected = process.env.ADMIN_KEY || "";

  if (!expected || key !== expected) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-slate-600">Chýba alebo nesedí kľúč. Pridaj ?k=... (ADMIN_KEY).</p>
      </main>
    );
  }

  const users = await listPilotUsers();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Viora Pilot Admin</h1>
          <p className="mt-1 text-sm text-slate-600">Users: {users.length}</p>
        </div>
        <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-sm">Domov</Link>
      </div>

      <div className="mt-6 overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-[920px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Ref</th>
              <th className="px-4 py-3">ReferredBy</th>
              <th className="px-4 py-3">Invites</th>
              <th className="px-4 py-3">Pilot Invites</th>
              <th className="px-4 py-3">Pilot</th>
              <th className="px-4 py-3">Trial Until</th>
              <th className="px-4 py-3">Claimed Addon</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-900">{u.email}</td>
                <td className="px-4 py-3 text-slate-700">{u.refCode}</td>
                <td className="px-4 py-3 text-slate-700">{u.referredBy || "-"}</td>
                <td className="px-4 py-3 text-slate-700">{u.directInvites}</td>
                <td className="px-4 py-3 text-slate-700">{u.pilotInvites}</td>
                <td className="px-4 py-3 text-slate-700">{u.isPilot ? "YES" : "no"}</td>
                <td className="px-4 py-3 text-slate-700">{u.trialUntil ? new Date(u.trialUntil).toISOString().slice(0, 19).replace("T", " ") : "-"}</td>
                <td className="px-4 py-3 text-slate-700">{u.claimedAddon || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-500">URL: /admin/pilot?k=ADMIN_KEY</p>
    </main>
  );
}
