import {Client} from "pg";
import {NotableAircraft, Plane} from "../models";
import {SettingsService} from "./settings-service";

export class DatabaseService {
    client: Client;

    constructor(private settingsService: SettingsService) {
        this.client = new Client({
            user: process.env.DBLOGIN,
            host: process.env.DBHOST,
            database: process.env.DBNAME,
            password: process.env.DBPASS,
            port: Number(process.env.DBPORT),
        });
        void this.client.connect();
    }

    disconnect() {
        void this.client.end();
    }

    async checkTables() {
        const aircraftTableQuery = {
            text: `create table if not exists aircraft (
                id int generated always as identity,
                type_code varchar(8),
                reg_num varchar(16),
                count int,
                flagged bool,
                current bool,
                date_modified timestamptz,
                date_created timestamptz default now()
            );`
        };
        const historyTableQuery = {
            text: `create table if not exists aircraft_history (
                id int generated always as identity,
                aircraft_id int,
                speed numeric,
                altitude numeric,
                lat numeric,
                lon numeric,
                track numeric,
                callsign varchar(32),
                distance numeric,
                date_created timestamptz default now()
            )`
        };
        const settingsTableQuery = {
            text: `create table if not exists settings (
                id int generated always as identity,
                setting_type varchar(32),
                setting_value text,
                date_modified timestamptz default now()
            );`
        };
        const logTableQuery = {
            text: `create table if not exists log (
              id int generated always as identity,
              log_type varchar(32),
              log_value text,
              detail text,
              date_created timestamptz default now()
            );`
        };
        const initSettings = {
            // setting initial request count > 200 so we start with a 5 min interval
            text: `insert into "settings" ("setting_type", "setting_value", "date_modified")
                select 'request_count', 250, now()
                where not exists (select 1 from "settings" where "setting_type" = 'request_count')`
        }
        await this.client.query(aircraftTableQuery);
        await this.client.query(historyTableQuery);
        await this.client.query(settingsTableQuery);
        await this.client.query(logTableQuery);
        await this.client.query(initSettings);
        await this.logMessage('checkTables', 'checkTables completed');
    }


    async getRequestCount() {
        const requestCountQuery = {
            text: `SELECT "setting_value" FROM "settings" WHERE "setting_type" = 'request_count'`
        }

        const result = await this.client.query(requestCountQuery);
        return +result.rows[0].setting_value;
    }

    async setRequestCount(value: string) {
        const resetRequestCountQuery = {
            text: `UPDATE "settings" SET "setting_value" = $1, "date_modified" = $2 WHERE "setting_type" = 'request_count'`,
            values: [value, new Date()]
        }

        await this.client.query(resetRequestCountQuery);
    }

    async getNotableAircraft() {
        const notables = new NotableAircraft();

        const notablesQuery = {
            text: `SELECT "setting_type", "setting_value", ar."MODE S CODE HEX" as hex_code
                FROM "settings" s
                         left join aircraft_registration ar on s.setting_value = concat('N', ar."N-NUMBER")
                and s.setting_type = 'reg_num'
                WHERE "setting_type" in ('type_code', 'reg_num')`
        }

        const result = await this.client.query(notablesQuery);
        result.rows.map(r => {
            if (r.setting_type === 'type_code') {
                notables.typeCodes.push(r.setting_value);
            }
            if (r.setting_type === 'reg_num') {
                notables.regNumbers.push(r.setting_value);
                notables.hexCodes.push(r.hex_code);
            }
        });

        return notables;
    }

    async logPlane(plane: Plane, flagged: boolean): Promise<boolean> {
        const existsQuery = {
            text: `select "id", "count", "current" from "aircraft" where "reg_num" = $1`,
            values: [plane.reg]
        };
        const result = await this.client.query(existsQuery);
        const count: number = result.rows[0]?.count;
        let aircraftId: number = result.rows[0]?.id;
        let isNew: boolean;

        if (count) {
            isNew = !result.rows[0]?.current;
            const updatePlaneQuery = {
                text: `update "aircraft" set "count" = $1, "flagged" = $2, "current" = true, "date_modified" = now() where "reg_num" = $3`,
                values: [
                    count + (isNew ? 1 : 0),
                    flagged,
                    plane.reg
                ]
            };
            await this.client.query(updatePlaneQuery);
        } else {
            isNew = true;
            const insertPlaneQuery = {
                text: `insert into "aircraft" ("type_code", "reg_num", "count", "flagged", "current", "date_modified")
                    values ($1, $2, $3, $4, true, now()) returning id;`,
                values: [
                    plane.type,
                    plane.reg,
                    1,
                    flagged
                ]
            };
            const result = await this.client.query(insertPlaneQuery);
            aircraftId = result.rows[0].id;
        }

        const updatePlaneHistoryQuery = {
            text: `insert into aircraft_history ("aircraft_id", "speed", "altitude", "lat", "lon", "track", "callsign", "distance")
                    values ($1, $2, $3, $4, $5, $6, $7, $8);`,
            values: [
                aircraftId,
                plane.spd === '' ? 0 : plane.spd,
                plane.alt === '' ? 0 : plane.alt,
                plane.lat === '' ? 0 : plane.lat,
                plane.lon === '' ? 0 : plane.lon,
                plane.trak === '' ? 0 : plane.trak,
                plane.call,
                plane.dst === '' ? 0 : plane.dst
            ]
        }
        await this.client.query(updatePlaneHistoryQuery);

        return isNew;
    }

    async updateFlags(planes: Plane[]) {
        const regNumArray = planes.map(p => p.reg).filter(r => r);
        const indexArr = regNumArray.map((r, i) => '$' + (i + 1));
        const flagQuery = planes.length > 0 ? {
            text: `update "aircraft" set "current" = false where "reg_num" not in (` + indexArr + `)`,
            values: regNumArray
        } : {
            text: `update "aircraft" set "current" = false where "current" = true`
        }
        await this.client.query(flagQuery);
    }

    async logSunriseSunset() {
        const insertValue = JSON.stringify({
            sunrise: this.settingsService.sunrise,
            sunset: this.settingsService.sunset,
            day: this.settingsService.currentDay
        });
        await this.logMessage('day', insertValue);
    }

    async logMessage(type: string, message: string) {
        await this.createLog('INFO', type, message);
    }

    async logWarning(type: string, message: string) {
        await this.createLog('WARN', type, message);
    }

    async logError(type: string, message: string) {
        await this.createLog('ERROR', type, message);
    }

    async createLog(level: string, type: string, message: string) {
        const logQuery = {
            text: `INSERT INTO "log" ("log_type", "log_value", "detail") VALUES ($1, $2, $3)`,
            values: [level, type, message]
        };

        await this.client.query(logQuery);
    }

    async logFrequency() {
        await this.logMessage('frequency', `Changing frequency to ${this.settingsService.frequency / 60000} minutes`)
    }

    async healthCheck() {
        const healthCheckQuery = {
            text: `select max("date_modified") as date_modified from "aircraft"`
        }
        const result = await this.client.query(healthCheckQuery);
        return result.rows[0]?.date_modified;
    }
}
