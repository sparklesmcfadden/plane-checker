export type Plane = {
    posttime: number;
    icao: string;
    reg: string;
    type: string;
    wtc: number
    spd: number;
    altt: number;
    alt: number;
    galt: number;
    talt: number;
    lat: number;
    lon: number;
    vsit: number;
    vsi: number;
    trkh: number;
    ttrk: number;
    trak: number;
    sqk: number;
    call: string;
    gnd: number;
    trt: number;
    pos: number;
    mlat: number;
    tisb: number;
    sat: number;
    opicao: string;
    cou: string;
    mil: number;
    interested: number;
    dst: number;
};

export class NotableAircraft {
    typeCodes: string[] = [];
    regNumbers: string[] = [];
}