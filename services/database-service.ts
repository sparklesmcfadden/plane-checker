import {Client} from "pg";
import {Day, HexReg, NotableAircraft, Plane} from "../models";

export class DatabaseService {
    client: Client;

    constructor() {
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

    async checkIfTableExists(tableName: string) {
        const query = {
            text: `SELECT to_regclass($1)`,
            values: [tableName]
        };
        const result = await this.client.query(query);
        return result.rows[0].to_regclass !== null;
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

    async getModeSHex(tailNumber: string) {
        if (tailNumber.toLowerCase().startsWith('n')) {
            tailNumber = tailNumber.slice(1);
        }
        const modeSQuery = {
            text: `select "MODE S CODE HEX" as hex_code from aircraft_registration where "N-NUMBER" = $1;`,
            values: [tailNumber]
        };
        const result = await this.client.query(modeSQuery);
        return result.rows[0].hex_code.trim();
    }

    async getTailNumber(modeSHex: string) {
        const tailNumberQuery = {
            text: `select "N-NUMBER" as tail_number from aircraft_registration where "MODE S CODE HEX" = $1;`,
            values: [modeSHex]
        };
        const result = await this.client.query(tailNumberQuery);
        return `N${result.rows[0].tail_number.trim()}`;
    }

    async getTypeFromHex(hexCode: string) {
        const typeQuery = {
            text: `select "MODE S CODE HEX", mfr, model  from aircraft_registration ar
                join aircraft_reference ref on ar."MFR MDL CODE" = ref.code
                where trim("MODE S CODE HEX") = $1`,
            values: [hexCode]
        }
        const result = await this.client.query(typeQuery);
        if (result.rows[0]) {
            return `${result.rows[0].mfr.trim()} ${result.rows[0].model.trim()}`;
        }
        return null;
    }

    async getTypeFromTailNumber(tailNumber: string) {
        if (tailNumber.toLowerCase().startsWith('n')) {
            tailNumber = tailNumber.slice(1);
        }
        const typeQuery = {
            text: `select "N-NUMBER", mfr, model  from aircraft_registration ar
                join aircraft_reference ref on ar."MFR MDL CODE" = ref.code
                where "N-NUMBER" = $1`,
            values: [tailNumber]
        }
        const result = await this.client.query(typeQuery);
        if (result.rows[0]) {
            return `${result.rows[0].mfr} ${result.rows[0].model}`;
        }
        return null;
    }

    async getNotableAircraft() {
        const notables = new NotableAircraft();

        const notablesQuery = {
            text: `SELECT "setting_type", "setting_value", trim(ar."MODE S CODE HEX") as hex_code
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
                const hexReg: HexReg = {
                    hexCode: r.hex_code,
                    regNumber: r.setting_value
                }
                notables.aircraft.push(hexReg);
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

    async logSunriseSunset(day: Day) {
        const insertValue = JSON.stringify(day);
        await this.logMessage('day', insertValue);
    }

    async getSunriseSunset(): Promise<Day> {
        const dayQuery = {
            text: `SELECT "log_value" FROM "log" WHERE "log_type" = 'day'`
        };
        const result = await this.client.query(dayQuery);
        return JSON.parse(result.rows[0].log_value) as Day;
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

    async logFrequency(frequency: number) {
        await this.logMessage('frequency', `Changing frequency to ${frequency / 60000} minutes`)
    }
}
