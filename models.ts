export type Plane = {
    posttime: string;
    icao: string;
    reg: string;
    type: string;
    wtc: string
    spd: string;
    altt: string;
    alt: string;
    galt: string;
    talt: string;
    lat: string;
    lon: string;
    vsit: string;
    vsi: string;
    trkh: string;
    ttrk: string;
    trak: string;
    sqk: string;
    call: string;
    gnd: string;
    trt: string;
    pos: string;
    mlat: string;
    tisb: string;
    sat: string;
    opicao: string;
    cou: string;
    mil: string;
    interested: string;
    dst: string;
};

export class NotableAircraft {
    typeCodes: string[] = [];
    regNumbers: string[] = [];
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