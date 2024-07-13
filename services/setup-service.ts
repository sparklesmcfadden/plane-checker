import {DatabaseService} from "./database-service";
import axios from "axios";
import {SettingsService} from "./settings-service";

export class SetupService {
    constructor(private dbService: DatabaseService,
                private settingsService: SettingsService) {
    }

    async getSunriseSunset() {
        const options = {
            method: 'GET',
            url: `https://api.sunrise-sunset.org/json?lat=${this.settingsService.lat}&lng=${this.settingsService.lon}&date=today&formatted=0`
        }

        try {
            const request = await axios.request(options);
            const result = request['data']['results'];
            this.settingsService.setDay(new Date(result['sunrise']), new Date(result['sunset']))
        } catch (err) {
            if (err instanceof Error) {
                await this.dbService.logError('getSunriseSunset', err.message);
            }
            this.settingsService.setDefaultDay();
        }

        await this.dbService.logSunriseSunset({
            sunrise: this.settingsService.sunrise,
            sunset: this.settingsService.sunset,
            day: this.settingsService.currentDay
        });
    }

    async updateSunriseSunset() {
        if (new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Chicago'})).getDate() !== this.settingsService.currentDay || this.settingsService.setByFallback) {
            this.settingsService.updateCurrentDay();
            await this.getSunriseSunset();
        }
    }

    async checkIsDaylight() {
        const now = new Date();
        const isDay = now > this.settingsService.sunrise && now < this.settingsService.sunset;
        if (isDay !== this.settingsService.isDay) {
            if (!isDay) {
                await this.dbService.updateFlags([]);
            }
            const message = `Daylight status changed. ${isDay ? 'Now checking traffic.' : 'Shutting down for the night.'}`
            await this.dbService.logMessage('checkIsDaylight', message)
            this.settingsService.isDay = isDay;
        }
        return isDay;
    }

    async updateNotables() {
        const notables = await this.dbService.getNotableAircraft();
        if (this.settingsService.updateNotables(notables)) {
            await this.dbService.logMessage('updateNotables', `Loaded ${notables.aircraft.length + notables.typeCodes.length} notable types or reg nums`);
        }
    }

    async setupTables() {
        await this.setupSystemTables();
        await this.setupFaaTypeTables();
        await this.setupAdsbTables();
        await this.setupOpenSkiesTables();
    }

    async setupFaaTypeTables() {
        if (!(await this.dbService.checkIfTableExists('aircraft_type'))) {
            const aircraftTypeTableQuery = {
                text: `drop table if exists aircraft_type;
                create table aircraft_type (
                    id int generated always as identity,
                    type_id text,
                    type_desc text
            );`
            };
            const aircraftTypeInsertQuery = {
                text: `insert into aircraft_type (type_id, type_desc) values
                ('1', 'Glider'),
                ('2', 'Balloon'),
                ('3', 'Blimp/Dirigible'),
                ('4', 'Fixed wing single engine'),
                ('5', 'Fixed wing multi engine'),
                ('6', 'Rotorcraft'),
                ('7', 'Weight-shift-control'),
                ('8', 'Powered Parachute'),
                ('9', 'Gyroplane'),
                ('H', 'Hybrid Lift'),
                ('O', 'Other');`
            };
            await this.dbService.client.query(aircraftTypeTableQuery);
            await this.dbService.client.query(aircraftTypeInsertQuery);
        }

        if (!(await this.dbService.checkIfTableExists('engine_type'))) {
            const engineTypeTableQuery = {
                text: `drop table if exists engine_type;
                create table engine_type (
                    id int generated always as identity,
                    engine_id int,
                    engine_desc text
            );`
            };
            const engineTypeInsertQuery = {
                text: `insert into engine_type (engine_id, engine_desc) values
                (0, 'None'),
                (1, 'Reciprocating'),
                (2, 'Turbo-prop'),
                (3, 'Turbo-shaft'),
                (4, 'Turbo-jet'),
                (5, 'Turbo-fan'),
                (6, 'Ramjet'),
                (7, '2 Cycle'),
                (8, '4 Cycle'),
                (9, 'Unknown'),
                (10, 'Electric'),
                (11, 'Rotary');`
            };
            await this.dbService.client.query(engineTypeTableQuery);
            await this.dbService.client.query(engineTypeInsertQuery);
        }
    }

    async setupOpenSkiesTables() {
        const openSkiesTrackTableQuery = {
            text: `create table if not exists openskies_track (
                id int generated always as identity,
                aircraft_id int,
                icao24 text,
                time timestamptz,
                latitude float,
                longitude float,
                baro_altitude float,
                true_track float,
                on_ground bool,
                date_created timestamptz default now()
            );`
        }
        const openSkiesStateTableQuery = {
            text: `create table if not exists openskies_state (
                id int generated always as identity,
                aircraft_id int,
                icao24 text,
                callsign text,
                origin_country text,
                time_position timestamptz,
                last_contact timestamptz,
                longitude float,
                latitude float,
                baro_altitude float,
                on_ground boolean,
                velocity float,
                true_track float,
                vertical_rate float,
                sensors text,
                geo_altitude float,
                squawk text,
                spi boolean,
                position_source int,
                category int,
                date_created timestamptz default now()
            );`
        }
        await this.dbService.client.query(openSkiesTrackTableQuery);
        await this.dbService.client.query(openSkiesStateTableQuery);
    }

    async setupAdsbTables() {
        const aircraftTableQuery = {
            text: `create table if not exists aircraft (
                id int generated always as identity,
                type_code text,
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
        await this.dbService.client.query(aircraftTableQuery);
        await this.dbService.client.query(historyTableQuery);
    }

    async setupSystemTables() {
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
            text: `insert into "settings" ("setting_type", "setting_value")
                select 'request_count', 250
                where not exists (select 1 from "settings" where "setting_type" = 'request_count')`
        }
        const faaLoadDateSetting = {
            text: `insert into "settings" ("setting_type", "setting_value")
                select 'faa_load_date', now()
                where not exists (select 1 from "settings" where "setting_type" = 'faa_load_date')`
        };
        const initAircraft = {
            text: `insert into "settings" ("setting_type", "setting_value")
                select 'reg_num', 'N628TS'
                where not exists (select 1 from "settings" where "setting_value" = 'N628TS');
            insert into "settings" ("setting_type", "setting_value")
                select 'reg_num', 'N272BG'
                where not exists (select 1 from "settings" where "setting_value" = 'N272BG');
            insert into "settings" ("setting_type", "setting_value")
                select 'reg_num', 'N502SX'
                where not exists (select 1 from "settings" where "setting_value" = 'N502SX');
            insert into "settings" ("setting_type", "setting_value")
                select 'type_code', 'SHIP'
                where not exists (select 1 from "settings" where "setting_value" = 'SHIP');`
        };
        await this.dbService.client.query(settingsTableQuery);
        await this.dbService.client.query(faaLoadDateSetting);
        await this.dbService.client.query(logTableQuery);
        await this.dbService.client.query(initSettings);
        await this.dbService.client.query(initAircraft);
        await this.dbService.logMessage('checkTables', 'checkTables completed');
    }
}