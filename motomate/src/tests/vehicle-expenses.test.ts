import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';

// Real SQLite built from the shipped migrations, so the repository runs its actual queries
vi.mock('../lib/db/index.js', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
	const schema = await import('../lib/db/schema.js');
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'drizzle' });
	return { db, sqlite };
});

import { db, sqlite } from '../lib/db/index.js';
import { users, vehicles, service_logs, finance_transactions } from '../lib/db/schema.js';
import { getVehicleExpenses } from '../lib/db/repositories/finance-transactions.js';

const OWNER = 'u_owner';
const STRANGER = 'u_stranger';
const VEHICLE = 'v_1';

beforeAll(async () => {
	await db.insert(users).values([
		{ id: OWNER, email: 'owner@example.com' },
		{ id: STRANGER, email: 'stranger@example.com' }
	]);
	await db.insert(vehicles).values({
		id: VEHICLE,
		user_id: OWNER,
		name: 'Vespa',
		make: 'Piaggio',
		model: 'GTS',
		year: 2020
	});

	await db.insert(finance_transactions).values({
		id: 'ft_1',
		vehicle_id: VEHICLE,
		user_id: OWNER,
		category: 'fuel',
		amount_cents: 5000,
		currency: 'EUR',
		performed_at: '2026-01-05'
	});

	await db.insert(service_logs).values([
		{
			id: 'sl_dealer',
			vehicle_id: VEHICLE,
			performed_at: '2026-02-10',
			odometer_at_service: 12000,
			cost_cents: 12000,
			currency: 'EUR'
		},
		{
			id: 'sl_no_cost',
			vehicle_id: VEHICLE,
			performed_at: '2026-03-01',
			odometer_at_service: 12500,
			cost_cents: null,
			currency: 'EUR'
		},
		{
			id: 'sl_zero_cost',
			vehicle_id: VEHICLE,
			performed_at: '2026-03-02',
			odometer_at_service: 12600,
			cost_cents: 0,
			currency: 'EUR'
		},
		{
			id: 'sl_last_year',
			vehicle_id: VEHICLE,
			performed_at: '2025-11-20',
			odometer_at_service: 9000,
			cost_cents: 7000,
			currency: 'GBP'
		}
	]);
});

afterAll(() => sqlite.close());

describe('getVehicleExpenses', () => {
	it('merges service log costs with finance transactions, newest first', async () => {
		const expenses = await getVehicleExpenses(VEHICLE, OWNER);

		expect(expenses).toEqual([
			{
				vehicle_id: VEHICLE,
				amount_cents: 12000,
				currency: 'EUR',
				category: 'maintenance',
				performed_at: '2026-02-10'
			},
			{
				vehicle_id: VEHICLE,
				amount_cents: 5000,
				currency: 'EUR',
				category: 'fuel',
				performed_at: '2026-01-05'
			},
			{
				vehicle_id: VEHICLE,
				amount_cents: 7000,
				currency: 'GBP',
				category: 'maintenance',
				performed_at: '2025-11-20'
			}
		]);
	});

	it('keeps the currency recorded on each entry so mixed currencies stay separate', async () => {
		const { totalByCurrency } = await import('../lib/utils/money.js');
		const expenses = await getVehicleExpenses(VEHICLE, OWNER);

		const yearTotal = totalByCurrency(
			expenses
				.filter((e) => e.performed_at >= '2026-01-01')
				.map((e) => ({ amountCents: e.amount_cents, currency: e.currency })),
			'EUR'
		);

		expect(yearTotal).toEqual({ mixed: false, cents: 17000, currency: 'EUR' });
	});

	it('returns nothing for a vehicle the user does not own', async () => {
		expect(await getVehicleExpenses(VEHICLE, STRANGER)).toEqual([]);
	});
});
