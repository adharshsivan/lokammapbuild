export type District = 'downtown' | 'north' | 'port' | 'beach' | 'lighthouse' | 'fort' | 'spaceport';
export type LayerId = 'terrain' | 'roads' | 'bridges' | 'buildings' | 'water' | 'reference' | District;
export type Point = [number, number];

// All plan coordinates use the supplied 1448 x 1086 image, not a procedural layout.
export const REFERENCE = { width: 1448, height: 1086, originX: 744, originY: 520 };

export const mainCoast: Point[] = [
  [750,62],[767,68],[780,76],[795,80],[807,93],[815,111],[811,137],[807,160],
  [826,174],[839,194],[849,215],[852,238],[861,259],[865,287],[866,315],[859,328],
  [844,339],[824,345],[808,358],[790,365],[768,361],[766,385],[784,387],[801,386],
  [820,394],[833,411],[841,433],[846,450],[855,465],[860,488],[862,512],[858,533],
  [863,558],[870,581],[867,600],[853,617],[845,626],[861,638],[881,652],[897,670],
  [909,695],[917,717],[918,730],[908,743],[890,751],[866,761],[842,773],[816,783],
  [791,796],[769,805],[747,816],[726,826],[705,835],[678,847],[651,860],[644,873],
  [645,901],[655,916],[676,926],[695,933],[709,934],[713,946],[705,958],[690,961],
  [677,955],[661,948],[641,943],[625,935],[613,923],[606,909],[601,887],[605,861],
  [602,844],[595,831],[596,817],[605,803],[624,793],[647,785],[670,775],[694,764],
  [717,754],[740,744],[763,733],[786,722],[775,708],[768,693],[783,678],[803,666],
  [820,652],[831,643],[820,637],[804,646],[786,657],[767,669],[747,680],[729,693],
  [710,701],[691,710],[670,716],[654,725],[644,741],[628,750],[609,747],[590,742],
  [568,741],[552,733],[541,717],[531,703],[515,688],[496,680],[474,676],[452,670],
  [435,667],[419,663],[405,653],[390,640],[379,624],[367,607],[355,588],[345,574],
  [337,555],[334,540],[341,520],[351,501],[353,488],[350,478],[359,464],[378,456],
  [398,451],[411,444],[420,433],[422,415],[428,400],[441,392],[461,384],[481,379],
  [498,368],[518,356],[539,348],[557,339],[575,323],[586,307],[590,284],[594,265],
  [601,247],[610,231],[618,214],[623,191],[628,172],[638,151],[649,133],[665,120],
  [678,111],[687,94],[699,77],[710,68],[725,69],[738,64],
];

export const beachCoast: Point[] = [
  [993,230],[1004,239],[1007,250],[1021,254],[1035,269],[1044,288],[1048,311],
  [1054,336],[1061,359],[1068,385],[1075,412],[1083,439],[1091,465],[1098,489],
  [1105,516],[1112,544],[1119,572],[1127,601],[1136,635],[1144,665],[1149,690],
  [1147,709],[1138,725],[1123,739],[1105,749],[1091,744],[1081,731],[1075,715],
  [1061,705],[1048,690],[1037,678],[1025,664],[1012,639],[998,623],[982,610],
  [968,603],[956,594],[950,582],[955,570],[967,557],[973,540],[973,521],
  [974,506],[966,486],[953,472],[950,455],[941,439],[945,427],[956,415],
  [960,397],[958,378],[960,355],[965,334],[969,312],[967,290],[969,270],
  [977,250],[986,235],
];

// The port is an independent land parcel cut from the southern/eastern lobe.
// Coordinates reuse the existing island outline so only the land connection changes.
export const portCoast: Point[] = [
  [845,626],[861,638],[881,652],[897,670],[909,695],[917,717],[918,730],[908,743],
  [890,751],[866,761],[842,773],[816,783],[791,796],[769,805],[747,816],[726,826],
  [705,835],[678,847],[651,860],[644,873],[645,901],[655,916],[676,926],[695,933],
  [709,934],[713,946],[705,958],[690,961],[677,955],[661,948],[641,943],[625,935],
  [613,923],[606,909],[601,887],[605,861],[602,844],[595,831],[596,817],[605,803],
  [624,793],[647,785],[670,775],[694,764],[717,754],[740,744],[763,733],[786,722],
  [775,708],[768,693],[783,678],[803,666],[820,652],[831,643],
];

// This channel is cut through the shared land edge; the road crosses it on a bridge.
export const portChannelCenterline: Point[] = [
  [845,626],[831,643],[820,652],[803,666],[783,678],[768,693],[775,708],[786,722],
];
export const portChannelWidth = 18;

export const portAprons: Point[][] = [
  [[631,847],[719,808],[742,851],[720,861],[723,891],[754,893],[753,926],[688,925],[685,886],[653,868]],
  [[751,794],[901,728],[928,786],[913,795],[902,776],[872,790],[869,803],[847,812],[839,797],[806,814],[817,838],[776,856]],
];

/**
 * Fort Island — landmass in grid A1/A2, off the map's north-west shoulder.
 * Traced in the same coastal language as the existing islands: soft juts and
 * recesses at 20-40 px scale, no geometric corners. A rocky promontory at the
 * north carries the old fort; the broad southern lobe is the space-centre terrace.
 * Outline is clockwise from the northern tip.
 * Note: grid row 1 starts at image z = -30, so the northern tip sits at a small
 * negative image coordinate. That is inside the world, just above the source image.
 */
export const fortCoast: Point[] = [
  // Northern promontory — the old-fort headland
  [297,-24],[309,-20],[319,-10],[325,4],[321,16],[327,26],[337,34],[332,48],[339,61],
  // East coast: sheltered bay plus the bulge facing the main island
  [348,76],[353,93],[350,109],[341,122],[345,135],[356,148],[359,164],[352,180],[341,195],
  // Southern lobe — the level space-centre terrace
  [327,207],[310,214],[293,215],[278,209],[266,198],[257,201],[248,192],
  // West coast
  [240,178],[234,162],[231,145],[235,128],[230,111],[237,95],[245,80],[252,64],[258,48],[264,31],[272,14],[282,-3],[290,-16],
];

/** Old-fort summit on the northern promontory (grid A1) — the island's highest ground. */
export const FORT: Point = [301, 25];
/** Launch terrace in the southern lobe (grid A2). */
export const SPACE_CENTER: Point = [273, 154];

/**
 * A10/Eyer Shoals — five uninhabited islets scattered across grids A9/A10 in the
 * south-west corner. Shared ~10-20 px irregular outlines, each unique in
 * proportions and character: rocky snorkel islets, a wading-bird sandbar, a tiny
 * palm copse, a granite outcrop and a mangrove fringe. The low-lying sandbars
 * partially flood at high tide.
 * Note: grid rows 9/10 begin at image z = 1050, so the shoals sit just south of
 * the source image — inside the world, below the original crop.
 */
export const eyerShoals: Point[][] = [
  // S1 Great Eyer — the dominant islet: rocky NE headland, two SE coves and a
  // long hooked sand spit sweeping off the SW tip. ~150 x 100 px.
  [[356,838],[352,824],[340,814],[326,808],[310,806],[296,802],[282,800],[268,804],
   [256,812],[247,822],[240,834],[236,846],[230,858],[222,868],[212,876],[204,886],
   [200,896],[206,902],[216,900],[226,894],[236,888],[246,884],[258,880],[270,878],
   [282,876],[294,876],[306,874],[318,870],[330,864],[340,856],[348,848]],
  // S2 Wader Bank — a thin crescent sandbar, barely above the tide line.
  [[282,912],[290,918],[288,926],[278,930],[266,932],[254,934],[243,938],[234,944],
   [228,952],[232,958],[241,956],[251,950],[262,946],[272,942],[281,936],[287,928],[286,918]],
  // S3 Palm Frill — three finger-like lobes reaching east, deep notch on the west.
  [[338,884],[350,880],[362,882],[372,888],[380,896],[374,900],[366,898],[372,906],
   [380,912],[372,916],[362,912],[368,922],[374,930],[364,932],[354,926],[344,922],
   [336,914],[332,904],[332,894]],
  // S4 Granite Point — a bare, angular skerry with a flat rock top.
  [[310,936],[322,934],[330,940],[332,950],[326,958],[314,960],[306,954],[304,944]],
  // S5 Mangrove Fringe — twin lobes joined by a low mangrove neck.
  [[352,932],[364,928],[376,930],[386,936],[392,946],[388,956],[378,960],[370,956],
   [364,960],[354,962],[344,958],[340,948],[344,938]],
  // Bare rock skerries scattered on the reef — no vegetation, just stone.
  [[398,872],[404,876],[402,882],[395,882],[392,876]],
  [[222,826],[228,830],[225,836],[218,834],[217,828]],
  [[300,976],[307,979],[305,986],[297,985],[295,978]],
];

export interface Road { id: string; path: string; width: number; bridge?: boolean; }
export const roads: Road[] = [
  { id: 'coastal-ring', width: 10, path: 'M645 299 L605 329 L574 352 L528 374 L490 390 L452 405 Q443 409 444 426 L440 445 L429 460 L404 487 L373 508 Q350 522 358 543 L373 578 L397 618 Q411 643 423 642 L441 641 Q456 643 473 650 L514 671 L552 687 L589 699 L624 706 Q635 707 654 701 L686 693 L715 682 L748 668 L783 646 L819 616 L837 602 Q846 596 843 580 L839 549 L838 512 L830 469 Q828 458 816 456 L809 430 Q805 414 792 407 Q780 399 759 399 L681 399 L681 345 L645 300' },
  { id: 'north-loop', width: 8.5, path: 'M645 300 Q657 291 656 276 L658 201 L667 162 L788 162 Q796 163 793 183 L792 233 L824 232 Q841 232 842 247 L845 305 Q846 314 836 319 L802 337 Q790 345 769 344 L682 344' },
  { id: 'north-second', width: 8, path: 'M658 232 L793 232' },
  { id: 'north-central', width: 8, path: 'M753 103 Q751 126 741 162 L737 344 L738 399' },
  { id: 'north-eastern', width: 7, path: 'M793 232 L792 334' },
  { id: 'gateway-west', width: 8, path: 'M587 343 L601 400 L609 454' },
  { id: 'market-street', width: 8, path: 'M528 374 L543 401 Q550 420 550 453 L548 521 L548 554 L549 619 L548 682' },
  { id: 'gateway-cross', width: 8, path: 'M542 402 L602 400 L682 399' },
  { id: 'central-cross', width: 9, path: 'M437 454 L550 453 L682 453 L749 454 L817 457' },
  { id: 'central-avenue', width: 9, path: 'M681 399 L682 520 L687 603 L704 686' },
  { id: 'eastern-avenue', width: 8, path: 'M750 400 L749 453 L754 521 L762 590 L782 646' },
  // Trimmed back to the Central Park's NE corner (matches central-avenue's 682,520
  // junction); the segment that used to cut across the merged plots is removed.
  { id: 'plaza-north', width: 8, path: 'M682 520 L754 524 L838 527' },
  { id: 'west-diagonal', width: 8, path: 'M405 490 L462 524 L493 539 L547 550' },
  { id: 'west-inner', width: 7, path: 'M431 506 L414 520 Q408 527 414 539 L430 562 L463 526 L486 454' },
  { id: 'south-cross', width: 8.5, path: 'M384 590 L429 571 L473 599 L507 617 Q527 622 550 619 L594 618 L641 608 L687 603 L761 588 L818 615' },
  { id: 'west-south-diagonal', width: 7, path: 'M507 617 L547 550' },
  { id: 'southwest-link', width: 7, path: 'M473 650 L495 621' },
  { id: 'south-center', width: 7, path: 'M595 618 L595 700' },
  { id: 'south-east', width: 7, path: 'M651 607 L662 698' },
  { id: 'south-east-lane', width: 6, path: 'M700 603 L718 680' },
  { id: 'port-coast', width: 9, path: 'M852 638 L875 655 Q888 664 893 683 L902 708 Q908 721 894 727 L852 746 L810 766 L766 787 L717 809 L671 831 L639 846 Q630 849 622 839 L618 834 Q608 822 621 812 L655 795 L693 778 L735 758 L762 745' },
  { id: 'harbor-approach', width: 8, path: 'M731 676 L737 688 M761 736 L775 768' },
  { id: 'harbor-south', width: 8, path: 'M639 846 Q622 851 622 865 L622 901 Q621 913 633 919 L665 934 L697 946' },
  { id: 'beach-spine', width: 9, path: 'M997 266 L996 305 Q996 335 1002 366 L1013 426 L1027 488 L1036 537 L1046 584 Q1064 649 1094 697' },
  { id: 'beach-bridge', width: 10, bridge: true, path: 'M837 527 Q909 525 969 509 L1028 494' },
  { id: 'port-bridge', width: 8, bridge: true, path: 'M737 688 L761 736' },
  { id: 'port-north-bridge', width: 8.5, bridge: true, path: 'M818 615 L852 638' },

  // ---- Fort Island (grid A1/A2) ----
  // Island artery: from the southern bridge landing north to the old-fort headland.
  { id: 'fort-island-spine', width: 9, path: 'M334 196 Q338 183 341 172 Q333 150 327 128 L320 100 Q314 72 308 48 L302 41' },
  // Space-centre approach, west from the spine to the launch terrace.
  { id: 'space-center-way', width: 8, path: 'M339 167 Q315 161 297 169 Q285 177 281 191' },
  // Southern service road: pad-side support to the control centre.
  { id: 'space-center-south', width: 7, path: 'M281 191 Q292 197 298 203' },
  // Vehicle-assembly spur off the space-centre approach.
  { id: 'vab-spur', width: 7, path: 'M316 165 L326 177' },
  // Causeway bridge south-east to the main island's coastal ring node at (452,405).
  { id: 'fort-bridge', width: 9, bridge: true, path: 'M334 196 Q390 295 452 405' },
];

export const piers: { path: string; width: number }[] = [
  { path: 'M791 125 L898 123', width: 6 },
  { path: 'M851 95 L851 147', width: 8 },
  { path: 'M869 107 L869 134', width: 3 },
  { path: 'M833 192 L881 192', width: 6 },
  { path: 'M869 162 L872 202 L882 202', width: 7 },
  { path: 'M1035 524 L1138 526', width: 5 },
  { path: 'M1129 511 L1129 531', width: 3 },
  { path: 'M923 747 L942 777', width: 5 },
  { path: 'M917 764 L937 802', width: 5 },
  { path: 'M884 800 L897 823', width: 4 },
  { path: 'M820 832 L834 858', width: 4 },
  { path: 'M790 846 L806 873', width: 3 },
  { path: 'M713 861 L713 884 L730 884', width: 5 },
];

export interface Building {
  x: number; y: number; w: number; d: number; h: number; r: number; district: District;
}
type Mass = [number, number, number, number, number, number?];
const massing = (district: District, blocks: Mass[]): Building[] => blocks.map(([x,y,w,d,h,r=0]) => ({ x,y,w,d,h,r,district }));

const RAW_BUILDINGS: Building[] = [
  ...massing('north', [
    [681,190,28,38,24],[679,218,25,13,11],[713,211,27,24,16],[767,204,29,41,32],
    [765,181,25,23,25],[634,252,18,25,13],[673,260,17,13,12],[699,261,15,14,11],
    [721,262,19,14,12],[757,261,23,13,15],[777,265,11,14,11],[815,250,21,17,16],
    [817,273,14,18,12],[817,297,23,14,12],[610,342,23,20,18,-22],[612,363,21,22,24,-12],
    [624,380,28,22,31],[644,376,10,32,18],[659,374,17,35,30],[714,376,31,44,39],
    [759,374,17,35,24],[547,385,20,20,16,-20],[574,378,23,25,19,-16],
  ]),
  ...massing('downtown', [
    [574,424,38,30,27],[565,415,15,16,17],[585,437,23,12,20],
    [633,418,39,18,32],[648,435,31,15,27],[621,438,13,13,13],
    [711,424,38,37,44],[704,439,22,11,29],[721,414,17,20,40],
    [754,425,17,34,31],[784,435,26,31,26,-9],
    [717,483,35,43,47],[730,505,16,21,28],
    [778,484,28,40,39],[805,478,27,24,34],[800,506,40,20,29],
    [496,433,31,18,12],[525,434,17,21,14],[476,435,13,17,13],
    [459,473,27,20,20,32],[448,491,23,28,27,32],[515,475,43,28,25],
    [495,511,32,26,21,22],[524,520,23,25,24],
    [383,537,29,31,18,-30],[402,561,30,24,20,-30],[433,527,26,30,16,33],
    [461,560,22,25,20,28],[495,573,29,26,23,32],
    [432,598,34,25,25,36],[447,612,26,21,21,38],[519,601,24,18,16,35],
    [574,537,19,12,18,-22],[564,572,13,29,21,-15],[576,590,23,14,17,24],
    [578,606,21,9,11],[617,596,20,8,12],[652,588,16,12,14],[665,576,11,24,16],
    [664,538,14,19,20],[704,546,22,30,36],[704,573,23,25,22],
    [732,540,22,17,20],[737,563,29,22,32],
    [807,554,20,27,23],[813,579,24,18,19],[789,573,13,25,15],[804,537,20,14,14],
    [572,644,30,30,28],[572,672,29,21,25],[620,670,34,25,32],[623,643,17,12,13],
    [667,628,22,34,30,-7],[675,665,24,29,29,-9],
    [735,621,35,32,38,-15],[744,646,31,22,23,-20],
    [506,637,29,22,19,28],[519,652,16,14,15,28],
  ]),
  ...massing('port', [
    [825,697,35,31,25,-25],[850,706,34,32,28,-25],[809,684,29,12,16,-25],
    [834,674,17,18,18,-25],[820,727,26,20,17,-25],[859,723,28,12,14,-25],
    [783,744,28,21,21,-24],[791,762,27,13,17,-24],[749,768,32,26,20,-24],
    [711,787,35,18,18,-24],[696,799,29,11,15,-24],[663,812,48,25,24,-24],
    [661,886,28,54,30],[637,878,13,46,18],[709,838,9,15,8,-23],
    [727,835,17,27,9,-24],[706,851,17,20,10,-24],[718,873,24,12,10],
    [717,906,41,15,8],[740,914,11,19,9],
    [795,811,20,26,14,-24],[821,804,23,16,17,-24],
    [852,784,39,19,19,-24],[874,767,28,13,14,-24],[839,790,12,16,12,-24],
    [767,819,14,19,12,-24],
  ]),
  ...massing('beach', [
    [980,450,20,24,12,-13],[983,380,20,24,12,-8],[984,351,17,20,11,-8],
    [1007,521,20,18,14,-13],[998,578,19,19,14,-22],[1007,602,24,20,13,-16],
    [1027,622,26,18,12,-16],[1024,646,21,19,12,-16],[1049,654,23,19,11,-16],
    [1066,681,19,17,14,-22],
  ]),
  // Old Fort: magazine, barracks and quarters clustered below the rampart.
  ...massing('fort', [
    [284, 55, 15, 10, 10],[300, 70, 13, 10, 9],[272, 80, 12, 9, 8],
  ]),
  // Space Centre: assembly, control and support works on the southern terrace.
  ...massing('spaceport', [
    [323, 186, 22, 16, 44],[312, 199, 15, 9, 15],[255, 175, 14, 9, 11],
  ]),
];

/* ---- Central Park: the four blocks hugging the downtown circle are open green ---- */
export const PLAZA_CENTER: Point = [618, 554];
export const PARK_RADIUS = 70;
const inCentralPark = (b: Building) =>
  Math.hypot(b.x - PLAZA_CENTER[0], b.y - PLAZA_CENTER[1]) < PARK_RADIUS;

export const buildings: Building[] = RAW_BUILDINGS.filter(b => !inCentralPark(b));

export const districts: { id: District; name: string; position: Point; label: Point; zoom: number }[] = [
  { id: 'lighthouse', name: 'Lighthouse', position: [751,104], label: [756,50], zoom: 3.7 },
  { id: 'north', name: 'North Town', position: [736,245], label: [750,245], zoom: 2.6 },
  { id: 'downtown', name: 'Downtown', position: [616,524], label: [589,510], zoom: 2.2 },
  { id: 'beach', name: 'Beach Island', position: [1035,478], label: [1112,459], zoom: 2.1 },
  { id: 'port', name: 'Port', position: [752,790], label: [782,862], zoom: 2.4 },
  { id: 'fort', name: 'Old Fort', position: [301,25], label: [333,11], zoom: 3.4 },
  { id: 'spaceport', name: 'Space Center', position: [281,177], label: [247,157], zoom: 2.5 },
];

/* ---- Location grid (100 m cells, labelled A-J x 1-11) ---- */
export const GRID_CELL = 100;
export const GRID_X0 = -500;   // west edge of column A, world metres
export const GRID_Z0 = -550;   // north edge of row 1, world metres
export const GRID_COLS = 10;   // columns A..J
export const GRID_ROWS = 11;   // rows 1..11

export const worldToImage = (x: number, z: number): Point => [x + REFERENCE.originX, z + REFERENCE.originY];
export const imageToWorld = (x: number, z: number): Point => [x - REFERENCE.originX, z - REFERENCE.originY];

export function gridRef(wx: number, wz: number) {
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((wx - GRID_X0) / GRID_CELL)));
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((wz - GRID_Z0) / GRID_CELL)));
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

const signed = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}`;
/** Copy-ready location string: grid cell, world metres, and image pixels (the map's native coordinates). */
export function formatCoords(wx: number, wz: number) {
  const [ix, iz] = worldToImage(wx, wz);
  return `grid ${gridRef(wx, wz)} · X ${signed(wx)} m · Z ${signed(wz)} m · image px (${Math.round(ix)}, ${Math.round(iz)})`;
}

export const pointString = (points: Point[]) => points.map(p => p.join(',')).join(' ');
export const layerNames: Record<LayerId, string> = {
  terrain: 'Terrain & coastline', roads: 'Road network', bridges: 'Bridges', buildings: 'Urban massing',
  water: 'Ocean', reference: 'Reference guide', downtown: 'Downtown', north: 'North Town',
  port: 'Port & industrial', beach: 'Beach Island', lighthouse: 'Lighthouse',
  fort: 'Old Fort', spaceport: 'Space Center',
};

export const defaultVisibility: Record<LayerId, boolean> = {
  terrain: true, roads: true, bridges: true, buildings: true, water: true, reference: false,
  downtown: true, north: true, port: true, beach: true, lighthouse: true,
  fort: true, spaceport: true,
};

export interface SceneSettings {
  visibility: Record<LayerId, boolean>;
  terrainHeight: number;
  buildingScale: number;
  waterLevel: number;
  shadows: boolean;
  labels: boolean;
  grid: boolean;
  mapGrid: boolean;
  renderMode: 'solid' | 'clay' | 'wireframe';
  colors: { terrain: string; roads: string; buildings: string; water: string };
  referenceOpacity: number;
}

export const defaultSettings: SceneSettings = {
  visibility: defaultVisibility, terrainHeight: 10, buildingScale: 1, waterLevel: 0,
  shadows: true, labels: true, grid: false, mapGrid: false, renderMode: 'solid', referenceOpacity: 0.5,
  colors: { terrain: '#ffffff', roads: '#4b5254', buildings: '#ffffff', water: '#2f86a3' },
};