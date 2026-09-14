import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db/index.js', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
	const schema = await import('$lib/db/schema.js');
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: 'drizzle' });
	return { db, sqlite };
});

import { db } from '$lib/db/index.js';
import { odometer_logs, users, vehicles } from '$lib/db/schema.js';
import {
	convertVehicleDistanceUnit,
	getOdometerLogs,
	getVehicleById
} from '$lib/db/repositories/vehicles.js';

const OWNER = 'u_1';
const VEHICLE = 'v_1';

beforeEach(async () => {
	await db.delete(odometer_logs);
	await db.delete(vehicles);
	await db.delete(users);
	await db.insert(users).values({ id: OWNER, email: 'owner@example.com' });
	await db.insert(vehicles).values({
		id: VEHICLE,
		user_id: OWNER,
		name: 'Vespa',
		make: 'Piaggio',
		model: 'GTS',
		year: 2020,
		current_odometer: 16093,
		current_measurement: 16093,
		current_measurement_unit: 'km',
		odometer_unit: 'km'
	});
	await db.insert(odometer_logs).values({
		id: 'odometer_1',
		vehicle_id: VEHICLE,
		user_id: OWNER,
		odometer: 16093,
		measurement: 16093,
		measurement_unit: 'km',
		recorded_at: '2026-09-14'
	});
});

describe('vehicle distance unit conversion', () => {
	it('persists miles for the vehicle and its recorded odometer entry after reload', async () => {
		expect(await convertVehicleDistanceUnit(VEHICLE, OWNER, 'mi')).toBe(true);

		const vehicle = await getVehicleById(VEHICLE, OWNER);
		const [log] = await getOdometerLogs(VEHICLE, OWNER);

		expect(vehicle).toMatchObject({
			odometer_unit: 'mi',
			current_measurement_unit: 'mi',
			current_odometer: 10000,
			current_measurement: 10000
		});
		expect(log).toMatchObject({ odometer: 10000, measurement: 10000, measurement_unit: 'mi' });
	});
});
