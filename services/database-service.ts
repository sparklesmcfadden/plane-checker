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
        this.client.connect();
    }

    async checkTables() {
        const aircraftTableQuery = {
            text: `create table if not exists aircraft (
                id int generated always as identity,
                type_code varchar(8),
                reg_num varchar(16),
                speed numeric,
                lat numeric,
                lon numeric,
                callsign varchar(32),
                distance numeric,
                count int,
                flagged bool,
                current bool,
                date_modified timestamptz,
                date_created timestamptz default now()
            );`
        };
        const settingsTableQuery = {
            text: `create table if not exists settings (
                id int generated always as identity,
                setting_type varchar(32),
                setting_value text,
                date_modified timestamptz
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
        await this.client.query(settingsTableQuery);
        await this.client.query(logTableQuery);
        await this.client.query(initSettings);
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
            text: `SELECT "setting_type", "setting_value" FROM "settings" 
                    WHERE "setting_type" in ('type_code', 'reg_num')`
        }

        const result = await this.client.query(notablesQuery);
        result.rows.map(r => {
            if (r.setting_type === 'type_code') {
                notables.typeCodes.push(r.setting_value);
            }
            if (r.setting_type === 'reg_num') {
                notables.regNumbers.push(r.setting_value);
            }
        });

        return notables;
    }

    async logPlane(plane: Plane, flagged: boolean): Promise<boolean> {
        const existsQuery = {
            text: `select "count", "current" from "aircraft" where "reg_num" = $1`,
            values: [plane.reg]
        };
        const result = await this.client.query(existsQuery);
        const count = result.rows[0]?.count;
        const current = result.rows[0]?.current || true;

        if (count) {
            const updatePlaneQuery = {
                text: `update "aircraft" set "speed" = $1, "lat" = $2, "lon" = $3, "callsign" = $4, "distance" = $5, 
                    "count" = $6, "flagged" = $7, "current" = true, "date_modified" = now() where "reg_num" = $8`,
                values: [
                    plane.spd,
                    plane.lat,
                    plane.lon,
                    plane.call,
                    plane.dst,
                    count + (current ? 0 : 1),
                    flagged,
                    plane.reg
                ]
            };
            await this.client.query(updatePlaneQuery);
        } else {
            const insertPlaneQuery = {
                text: `insert into "aircraft" ("type_code", "reg_num", "speed", "lat", "lon", "callsign", "distance", "count", "flagged", "current", "date_modified")
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, now());`,
                values: [
                    plane.type,
                    plane.reg,
                    plane.spd,
                    plane.lat,
                    plane.lon,
                    plane.call,
                    plane.dst,
                    1,
                    flagged
                ]
            };
            await this.client.query(insertPlaneQuery);
        }
        return current;
    }

    async updateFlags(planes: Plane[]) {
        const regNumArray = planes.map(p => p.reg).filter(r => r);
        const indexArr = regNumArray.map((r, i) => '$' + (i + 1));
        const flagQuery = {
            text: `update "aircraft" set "current" = false where "reg_num" not in (` + indexArr + `)`,
            values: regNumArray
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
        await this.logMessage('frequency', `Changing frequency to ${this.settingsService.frequency}`)
    }

    async healthCheck() {
        const healthCheckQuery = {
            text: `select max("date_modified") as date_modified from "aircraft"`
        }
        const result = await this.client.query(healthCheckQuery);
        return result.rows[0]?.date_modified;
    }
}
