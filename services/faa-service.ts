import {DatabaseService} from "./database-service";
import * as fs from "fs";
import axios, {AxiosRequestConfig} from "axios";
import AdmZip from "adm-zip";
import * as path from "path";
import {from} from "pg-copy-streams";

export class FaaService {

    constructor(private dbService: DatabaseService) {
    }

    async loadFaaData() {
        await this.setupTypeTables();
        await this.setupRegistrationTables();
        await this.getFaaData();
        await this.loadFileToDb('MASTER', 'aircraft_registration');
        await this.loadFileToDb('ACFTREF', 'aircraft_reference');
        await this.dbService.logMessage('faaService', 'FAA data setup complete');
    }

    async getModeSHex(tailNumber: string) {
        if (tailNumber.toLowerCase().startsWith('n')) {
            tailNumber = tailNumber.slice(1);
        }
        const modeSQuery = {
            text: `select "MODE S CODE HEX" as hex_code from aircraft_registration where "N-NUMBER" = $1;`,
            values: [tailNumber]
        };
        const result = await this.dbService.client.query(modeSQuery);
        return result.rows[0].hex_code.trim();
    }

    async getFaaData() {
        const options: AxiosRequestConfig = {
            method: 'GET',
            url: `https://registry.faa.gov/database/ReleasableAircraft.zip`,
            responseType: 'arraybuffer',
            headers: {
                'Content-Type': 'application/gzip'
            }
        };
        const response = await axios.request(options);
        const zip = new AdmZip(response.data);
        zip.extractAllTo('temp');
    }

    async loadFileToDb(fileName: string, tableName: string) {
        const inputFile = path.join(`temp/${fileName}.txt`);
        const dbStream = this.dbService.client.query(from(`COPY ${tableName} FROM STDIN (NULL "NULL", DELIMITER ',', FORMAT CSV, HEADER);`))
        const fileStream = fs.createReadStream(inputFile)

        fileStream.on('error', async (error) => await this.dbService.logError(`file_read-${fileName}`, error.message));
        dbStream.on('error', async (error) => await this.dbService.logError(`db_copy-${tableName}`, error.message));
        fileStream.on('end', async () => {
            await this.dbService.logMessage('faaDataLoad', 'Data load successful');
        });
        await fileStream.pipe(dbStream);
    }

    async setupRegistrationTables() {
        const dropTablesQuery = {
            text: `drop table if exists aircraft_registration; drop table if exists aircraft_reference;`
        };
        await this.dbService.client.query(dropTablesQuery);

        const registrationTableQuery = {
            text: `create table aircraft_registration
            (
                "N-NUMBER"         text,
                "SERIAL NUMBER"    text,
                "MFR MDL CODE"     text,
                "ENG MFR MDL"      text,
                "YEAR MFR"         text,
                "TYPE REGISTRANT"  text,
                name               text,
                street             text,
                street2            text,
                city               text,
                state              text,
                "ZIP CODE"         text,
                region             text,
                county             text,
                country            text,
                "LAST ACTION DATE" text,
                "CERT ISSUE DATE"  text,
                certification      text,
                "TYPE AIRCRAFT"    text,
                "TYPE ENGINE"      integer,
                "STATUS CODE"      text,
                "MODE S CODE"      text,
                "FRACT OWNER"      text,
                "AIR WORTH DATE"   text,
                "OTHER NAMES(1)"   text,
                "OTHER NAMES(2)"   text,
                "OTHER NAMES(3)"   text,
                "OTHER NAMES(4)"   text,
                "OTHER NAMES(5)"   text,
                "EXPIRATION DATE"  text,
                "UNIQUE ID"        text,
                "KIT MFR"          text,
                "KIT MODEL"        text,
                "MODE S CODE HEX"  text,
                trailer            text
            );`
        }
        const referenceTableQuery = {
            text: `create table aircraft_reference
                (
                    code             text,
                    mfr              text,
                    model            text,
                    "TYPE-ACFT"      text,
                    "TYPE-ENG"       text,
                    "AC-CAT"         text,
                    "BUILD-CERT-IND" text,
                    "NO-ENG"         text,
                    "NO-SEATS"       text,
                    "AC-WEIGHT"      text,
                    speed            text,
                    "TC-DATA-SHEET"  text,
                    "TC-DATA-HOLDER" text,
                    trailer          text
                );`
        }
        await this.dbService.client.query(registrationTableQuery);
        await this.dbService.client.query(referenceTableQuery);
    }


    async setupTypeTables() {
        const dropTablesQuery = {
            text: `drop table if exists aircraft_type; drop table if exists engine_type;`
        };
        await this.dbService.client.query(dropTablesQuery);
        const aircraftTypeTableQuery = {
            text: `create table aircraft_type (
                id int generated always as identity,
                type_id text,
                type_desc text
            );`
        };
        const engineTypeTableQuery = {
            text: `create table engine_type (
                id int generated always as identity,
                engine_id int,
                engine_desc text
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

        await this.dbService.client.query(aircraftTypeTableQuery);
        await this.dbService.client.query(engineTypeTableQuery);
        await this.dbService.client.query(aircraftTypeInsertQuery);
        await this.dbService.client.query(engineTypeInsertQuery);
    }
}