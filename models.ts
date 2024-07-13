export type Plane = {
    posttime?: string;
    icao: string;
    reg: string;
    type: string;
    wtc?: string
    spd: string;
    altt?: string;
    alt: string;
    galt?: string;
    talt?: string;
    lat: string;
    lon: string;
    vsit?: string;
    vsi?: string;
    trkh?: string;
    ttrk?: string;
    trak: string;
    sqk?: string;
    call: string;
    gnd?: string;
    trt?: string;
    pos?: string;
    mlat?: string;
    tisb?: string;
    sat?: string;
    opicao?: string;
    cou?: string;
    mil?: string;
    interested?: string;
    dst: string;
};

export class NotableAircraft {
    typeCodes: string[] = [];
    aircraft: HexReg[] = [];
}

export type HexReg = {
    regNumber: string;
    hexCode: string;
}

export type AdsbResponse = {
    status: number;
    statusText: string;
    headers: any;
    config: any;
    request: any;
    data: AdsbData;
}

export type AdsbData = {
    ac: Plane[];
    total: number;
    ctime: number;
    distmax: string;
    ptime: number;
}

export type OpenSkiesTrackResponse = {
    responseCode?: number;
    icao24: string;
    startTime: number;
    endTime: number;
    callsign: string;
    path: any[];
}

export type Day = {
    sunrise: Date;
    sunset: Date;
    day: number;
}

export type OpenSkiesStateResponse = {
    responseCode?: number;
    time: number;
    states: OpenSkiesState[];
}

export type OpenSkiesState = {
    icao24: string;
    callsign: string;
    origin_country: string;
    time_position: number;
    last_contact: number;
    longitude: number;
    latitude: number;
    baro_altitude: number;
    on_ground: boolean;
    velocity: number;
    true_track: number;
    vertical_rate: number;
    sensors: any[];
    geo_altitude: number;
    squawk: string;
    spi: boolean;
    position_source: number;
}
