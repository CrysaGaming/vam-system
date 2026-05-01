// System-curated AircraftType seed catalog. ICAO-doc-8643 designators with
// typical specs (max range nm, 2-class capacity, cruise speed kt, fuel burn
// kg/h cruise). Numbers are manufacturer-published or industry-typical;
// users can request corrections via AircraftTypeRequest flow if needed.
//
// Categories: narrow_body | wide_body | regional | cargo | ga
//
// Coverage Phase 1: ~80 most-common types in commercial + GA aviation. NOT
// exhaustive — request-flow lets airline-admins propose missing types
// (e.g. exotic types, military variants, retired types).
//
// Manufacturer naming standardized: "Boeing", "Airbus", "Embraer",
// "Bombardier", "ATR", "McDonnell Douglas", "BAE Systems", "Cessna",
// "Beechcraft", "Piper", "Cirrus".

export type AircraftTypeSeed = {
  icaoType: string;
  name: string;
  manufacturer: string;
  category: 'narrow_body' | 'wide_body' | 'regional' | 'cargo' | 'ga';
  rangeNm: number;
  capacityPax: number;
  cruiseSpeedKt: number;
  fuelBurnKgH: number;
};

export const aircraftTypeSeed: AircraftTypeSeed[] = [
  // ───── Airbus Narrow-Body ─────
  { icaoType: 'A318', name: 'Airbus A318', manufacturer: 'Airbus', category: 'narrow_body', rangeNm: 3100, capacityPax: 107, cruiseSpeedKt: 447, fuelBurnKgH: 2200 },
  { icaoType: 'A319', name: 'Airbus A319', manufacturer: 'Airbus', category: 'narrow_body', rangeNm: 3700, capacityPax: 124, cruiseSpeedKt: 447, fuelBurnKgH: 2400 },
  { icaoType: 'A320', name: 'Airbus A320', manufacturer: 'Airbus', category: 'narrow_body', rangeNm: 3300, capacityPax: 150, cruiseSpeedKt: 447, fuelBurnKgH: 2500 },
  { icaoType: 'A321', name: 'Airbus A321', manufacturer: 'Airbus', category: 'narrow_body', rangeNm: 3200, capacityPax: 185, cruiseSpeedKt: 447, fuelBurnKgH: 2700 },
  { icaoType: 'A19N', name: 'Airbus A319neo', manufacturer: 'Airbus', category: 'narrow_body', rangeNm: 3750, capacityPax: 140, cruiseSpeedKt: 447, fuelBurnKgH: 2050 },
  { icaoType: 'A20N', name: 'Airbus A320neo', manufacturer: 'Airbus', category: 'narrow_body', rangeNm: 3500, capacityPax: 165, cruiseSpeedKt: 447, fuelBurnKgH: 2100 },
  { icaoType: 'A21N', name: 'Airbus A321neo', manufacturer: 'Airbus', category: 'narrow_body', rangeNm: 4000, capacityPax: 220, cruiseSpeedKt: 447, fuelBurnKgH: 2350 },

  // ───── Airbus Wide-Body ─────
  { icaoType: 'A306', name: 'Airbus A300-600', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 4050, capacityPax: 266, cruiseSpeedKt: 460, fuelBurnKgH: 5500 },
  { icaoType: 'A310', name: 'Airbus A310-300', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 5200, capacityPax: 240, cruiseSpeedKt: 460, fuelBurnKgH: 5200 },
  { icaoType: 'A332', name: 'Airbus A330-200', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 7250, capacityPax: 247, cruiseSpeedKt: 470, fuelBurnKgH: 5400 },
  { icaoType: 'A333', name: 'Airbus A330-300', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 6350, capacityPax: 277, cruiseSpeedKt: 470, fuelBurnKgH: 5600 },
  { icaoType: 'A338', name: 'Airbus A330-800neo', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 8150, capacityPax: 257, cruiseSpeedKt: 470, fuelBurnKgH: 4700 },
  { icaoType: 'A339', name: 'Airbus A330-900neo', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 7200, capacityPax: 287, cruiseSpeedKt: 470, fuelBurnKgH: 4800 },
  { icaoType: 'A342', name: 'Airbus A340-200', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 7450, capacityPax: 240, cruiseSpeedKt: 475, fuelBurnKgH: 6300 },
  { icaoType: 'A343', name: 'Airbus A340-300', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 7400, capacityPax: 295, cruiseSpeedKt: 475, fuelBurnKgH: 6500 },
  { icaoType: 'A345', name: 'Airbus A340-500', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 9000, capacityPax: 313, cruiseSpeedKt: 481, fuelBurnKgH: 7100 },
  { icaoType: 'A346', name: 'Airbus A340-600', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 7900, capacityPax: 326, cruiseSpeedKt: 481, fuelBurnKgH: 7300 },
  { icaoType: 'A359', name: 'Airbus A350-900', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 8100, capacityPax: 325, cruiseSpeedKt: 488, fuelBurnKgH: 5800 },
  { icaoType: 'A35K', name: 'Airbus A350-1000', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 8700, capacityPax: 369, cruiseSpeedKt: 488, fuelBurnKgH: 6400 },
  { icaoType: 'A388', name: 'Airbus A380-800', manufacturer: 'Airbus', category: 'wide_body', rangeNm: 8000, capacityPax: 525, cruiseSpeedKt: 488, fuelBurnKgH: 11500 },

  // ───── Boeing Narrow-Body ─────
  { icaoType: 'B712', name: 'Boeing 717-200', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 2060, capacityPax: 117, cruiseSpeedKt: 438, fuelBurnKgH: 2300 },
  { icaoType: 'B731', name: 'Boeing 737-100', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 1540, capacityPax: 124, cruiseSpeedKt: 420, fuelBurnKgH: 2700 },
  { icaoType: 'B732', name: 'Boeing 737-200', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 1900, capacityPax: 136, cruiseSpeedKt: 420, fuelBurnKgH: 2800 },
  { icaoType: 'B733', name: 'Boeing 737-300', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 2400, capacityPax: 142, cruiseSpeedKt: 433, fuelBurnKgH: 2600 },
  { icaoType: 'B734', name: 'Boeing 737-400', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 2060, capacityPax: 168, cruiseSpeedKt: 433, fuelBurnKgH: 2700 },
  { icaoType: 'B735', name: 'Boeing 737-500', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 2400, capacityPax: 122, cruiseSpeedKt: 433, fuelBurnKgH: 2500 },
  { icaoType: 'B736', name: 'Boeing 737-600', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3235, capacityPax: 110, cruiseSpeedKt: 453, fuelBurnKgH: 2400 },
  { icaoType: 'B737', name: 'Boeing 737-700', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3010, capacityPax: 126, cruiseSpeedKt: 453, fuelBurnKgH: 2500 },
  { icaoType: 'B738', name: 'Boeing 737-800', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 2935, capacityPax: 162, cruiseSpeedKt: 453, fuelBurnKgH: 2600 },
  { icaoType: 'B739', name: 'Boeing 737-900', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 2950, capacityPax: 178, cruiseSpeedKt: 453, fuelBurnKgH: 2700 },
  { icaoType: 'B73G', name: 'Boeing 737-700', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3010, capacityPax: 126, cruiseSpeedKt: 453, fuelBurnKgH: 2500 },
  { icaoType: 'B7M7', name: 'Boeing 737 MAX 7', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3850, capacityPax: 138, cruiseSpeedKt: 453, fuelBurnKgH: 2200 },
  { icaoType: 'B7M8', name: 'Boeing 737 MAX 8', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3550, capacityPax: 178, cruiseSpeedKt: 453, fuelBurnKgH: 2300 },
  { icaoType: 'B7M9', name: 'Boeing 737 MAX 9', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3550, capacityPax: 193, cruiseSpeedKt: 453, fuelBurnKgH: 2400 },
  { icaoType: 'B7MJ', name: 'Boeing 737 MAX 10', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3300, capacityPax: 204, cruiseSpeedKt: 453, fuelBurnKgH: 2450 },
  { icaoType: 'B752', name: 'Boeing 757-200', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3915, capacityPax: 200, cruiseSpeedKt: 458, fuelBurnKgH: 3300 },
  { icaoType: 'B753', name: 'Boeing 757-300', manufacturer: 'Boeing', category: 'narrow_body', rangeNm: 3400, capacityPax: 243, cruiseSpeedKt: 458, fuelBurnKgH: 3500 },

  // ───── Boeing Wide-Body ─────
  { icaoType: 'B762', name: 'Boeing 767-200', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 5990, capacityPax: 224, cruiseSpeedKt: 461, fuelBurnKgH: 4400 },
  { icaoType: 'B763', name: 'Boeing 767-300', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 5990, capacityPax: 269, cruiseSpeedKt: 461, fuelBurnKgH: 4600 },
  { icaoType: 'B764', name: 'Boeing 767-400ER', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 5625, capacityPax: 304, cruiseSpeedKt: 461, fuelBurnKgH: 4900 },
  { icaoType: 'B772', name: 'Boeing 777-200', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 5240, capacityPax: 305, cruiseSpeedKt: 482, fuelBurnKgH: 6700 },
  { icaoType: 'B77L', name: 'Boeing 777-200LR', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 8555, capacityPax: 301, cruiseSpeedKt: 482, fuelBurnKgH: 6700 },
  { icaoType: 'B773', name: 'Boeing 777-300', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 6005, capacityPax: 368, cruiseSpeedKt: 482, fuelBurnKgH: 7200 },
  { icaoType: 'B77W', name: 'Boeing 777-300ER', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 7370, capacityPax: 396, cruiseSpeedKt: 482, fuelBurnKgH: 7400 },
  { icaoType: 'B788', name: 'Boeing 787-8', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 7355, capacityPax: 248, cruiseSpeedKt: 488, fuelBurnKgH: 5400 },
  { icaoType: 'B789', name: 'Boeing 787-9', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 7635, capacityPax: 296, cruiseSpeedKt: 488, fuelBurnKgH: 5600 },
  { icaoType: 'B78X', name: 'Boeing 787-10', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 6430, capacityPax: 336, cruiseSpeedKt: 488, fuelBurnKgH: 5800 },
  { icaoType: 'B741', name: 'Boeing 747-100', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 4620, capacityPax: 366, cruiseSpeedKt: 493, fuelBurnKgH: 11000 },
  { icaoType: 'B742', name: 'Boeing 747-200', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 6850, capacityPax: 400, cruiseSpeedKt: 493, fuelBurnKgH: 11200 },
  { icaoType: 'B744', name: 'Boeing 747-400', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 7260, capacityPax: 416, cruiseSpeedKt: 493, fuelBurnKgH: 10800 },
  { icaoType: 'B748', name: 'Boeing 747-8', manufacturer: 'Boeing', category: 'wide_body', rangeNm: 7730, capacityPax: 467, cruiseSpeedKt: 493, fuelBurnKgH: 10900 },

  // ───── Cargo Variants ─────
  { icaoType: 'B74F', name: 'Boeing 747-400F', manufacturer: 'Boeing', category: 'cargo', rangeNm: 4445, capacityPax: 0, cruiseSpeedKt: 493, fuelBurnKgH: 11000 },
  { icaoType: 'B748F', name: 'Boeing 747-8F', manufacturer: 'Boeing', category: 'cargo', rangeNm: 4390, capacityPax: 0, cruiseSpeedKt: 493, fuelBurnKgH: 10800 },
  { icaoType: 'B77F', name: 'Boeing 777F', manufacturer: 'Boeing', category: 'cargo', rangeNm: 4880, capacityPax: 0, cruiseSpeedKt: 482, fuelBurnKgH: 7000 },
  { icaoType: 'B763F', name: 'Boeing 767-300F', manufacturer: 'Boeing', category: 'cargo', rangeNm: 3225, capacityPax: 0, cruiseSpeedKt: 461, fuelBurnKgH: 4500 },
  { icaoType: 'MD11F', name: 'McDonnell Douglas MD-11F', manufacturer: 'McDonnell Douglas', category: 'cargo', rangeNm: 3990, capacityPax: 0, cruiseSpeedKt: 473, fuelBurnKgH: 6800 },

  // ───── Embraer ─────
  { icaoType: 'E135', name: 'Embraer ERJ-135', manufacturer: 'Embraer', category: 'regional', rangeNm: 1750, capacityPax: 37, cruiseSpeedKt: 447, fuelBurnKgH: 1100 },
  { icaoType: 'E145', name: 'Embraer ERJ-145', manufacturer: 'Embraer', category: 'regional', rangeNm: 1550, capacityPax: 50, cruiseSpeedKt: 447, fuelBurnKgH: 1200 },
  { icaoType: 'E170', name: 'Embraer 170', manufacturer: 'Embraer', category: 'regional', rangeNm: 2100, capacityPax: 78, cruiseSpeedKt: 447, fuelBurnKgH: 1700 },
  { icaoType: 'E175', name: 'Embraer 175', manufacturer: 'Embraer', category: 'regional', rangeNm: 2200, capacityPax: 88, cruiseSpeedKt: 447, fuelBurnKgH: 1800 },
  { icaoType: 'E190', name: 'Embraer 190', manufacturer: 'Embraer', category: 'regional', rangeNm: 2450, capacityPax: 106, cruiseSpeedKt: 447, fuelBurnKgH: 2000 },
  { icaoType: 'E195', name: 'Embraer 195', manufacturer: 'Embraer', category: 'regional', rangeNm: 2300, capacityPax: 124, cruiseSpeedKt: 447, fuelBurnKgH: 2100 },
  { icaoType: 'E290', name: 'Embraer E190-E2', manufacturer: 'Embraer', category: 'regional', rangeNm: 2850, capacityPax: 114, cruiseSpeedKt: 447, fuelBurnKgH: 1700 },
  { icaoType: 'E295', name: 'Embraer E195-E2', manufacturer: 'Embraer', category: 'regional', rangeNm: 2600, capacityPax: 132, cruiseSpeedKt: 447, fuelBurnKgH: 1800 },

  // ───── Bombardier / De Havilland Canada / CRJ ─────
  { icaoType: 'CRJ1', name: 'Bombardier CRJ-100', manufacturer: 'Bombardier', category: 'regional', rangeNm: 1650, capacityPax: 50, cruiseSpeedKt: 447, fuelBurnKgH: 1100 },
  { icaoType: 'CRJ2', name: 'Bombardier CRJ-200', manufacturer: 'Bombardier', category: 'regional', rangeNm: 1700, capacityPax: 50, cruiseSpeedKt: 447, fuelBurnKgH: 1100 },
  { icaoType: 'CRJ7', name: 'Bombardier CRJ-700', manufacturer: 'Bombardier', category: 'regional', rangeNm: 1820, capacityPax: 70, cruiseSpeedKt: 473, fuelBurnKgH: 1500 },
  { icaoType: 'CRJ9', name: 'Bombardier CRJ-900', manufacturer: 'Bombardier', category: 'regional', rangeNm: 1550, capacityPax: 86, cruiseSpeedKt: 473, fuelBurnKgH: 1700 },
  { icaoType: 'CRJX', name: 'Bombardier CRJ-1000', manufacturer: 'Bombardier', category: 'regional', rangeNm: 1620, capacityPax: 104, cruiseSpeedKt: 473, fuelBurnKgH: 1900 },
  { icaoType: 'DH8A', name: 'De Havilland Canada Dash 8-100', manufacturer: 'Bombardier', category: 'regional', rangeNm: 920, capacityPax: 37, cruiseSpeedKt: 270, fuelBurnKgH: 700 },
  { icaoType: 'DH8B', name: 'De Havilland Canada Dash 8-200', manufacturer: 'Bombardier', category: 'regional', rangeNm: 920, capacityPax: 37, cruiseSpeedKt: 295, fuelBurnKgH: 700 },
  { icaoType: 'DH8C', name: 'De Havilland Canada Dash 8-300', manufacturer: 'Bombardier', category: 'regional', rangeNm: 950, capacityPax: 50, cruiseSpeedKt: 286, fuelBurnKgH: 800 },
  { icaoType: 'DH8D', name: 'De Havilland Canada Dash 8-400', manufacturer: 'Bombardier', category: 'regional', rangeNm: 1100, capacityPax: 78, cruiseSpeedKt: 360, fuelBurnKgH: 1100 },

  // ───── ATR ─────
  { icaoType: 'AT43', name: 'ATR 42-300', manufacturer: 'ATR', category: 'regional', rangeNm: 720, capacityPax: 48, cruiseSpeedKt: 265, fuelBurnKgH: 600 },
  { icaoType: 'AT45', name: 'ATR 42-500', manufacturer: 'ATR', category: 'regional', rangeNm: 850, capacityPax: 48, cruiseSpeedKt: 300, fuelBurnKgH: 650 },
  { icaoType: 'AT46', name: 'ATR 42-600', manufacturer: 'ATR', category: 'regional', rangeNm: 800, capacityPax: 50, cruiseSpeedKt: 300, fuelBurnKgH: 650 },
  { icaoType: 'AT72', name: 'ATR 72-200', manufacturer: 'ATR', category: 'regional', rangeNm: 850, capacityPax: 70, cruiseSpeedKt: 275, fuelBurnKgH: 750 },
  { icaoType: 'AT75', name: 'ATR 72-500', manufacturer: 'ATR', category: 'regional', rangeNm: 825, capacityPax: 70, cruiseSpeedKt: 275, fuelBurnKgH: 760 },
  { icaoType: 'AT76', name: 'ATR 72-600', manufacturer: 'ATR', category: 'regional', rangeNm: 825, capacityPax: 70, cruiseSpeedKt: 275, fuelBurnKgH: 720 },

  // ───── McDonnell Douglas (legacy) ─────
  { icaoType: 'MD11', name: 'McDonnell Douglas MD-11', manufacturer: 'McDonnell Douglas', category: 'wide_body', rangeNm: 6800, capacityPax: 293, cruiseSpeedKt: 473, fuelBurnKgH: 6800 },
  { icaoType: 'MD81', name: 'McDonnell Douglas MD-81', manufacturer: 'McDonnell Douglas', category: 'narrow_body', rangeNm: 1500, capacityPax: 155, cruiseSpeedKt: 438, fuelBurnKgH: 2900 },
  { icaoType: 'MD82', name: 'McDonnell Douglas MD-82', manufacturer: 'McDonnell Douglas', category: 'narrow_body', rangeNm: 2050, capacityPax: 155, cruiseSpeedKt: 438, fuelBurnKgH: 2900 },
  { icaoType: 'MD83', name: 'McDonnell Douglas MD-83', manufacturer: 'McDonnell Douglas', category: 'narrow_body', rangeNm: 2500, capacityPax: 155, cruiseSpeedKt: 438, fuelBurnKgH: 2950 },
  { icaoType: 'MD88', name: 'McDonnell Douglas MD-88', manufacturer: 'McDonnell Douglas', category: 'narrow_body', rangeNm: 2050, capacityPax: 142, cruiseSpeedKt: 438, fuelBurnKgH: 2900 },
  { icaoType: 'MD90', name: 'McDonnell Douglas MD-90', manufacturer: 'McDonnell Douglas', category: 'narrow_body', rangeNm: 2400, capacityPax: 153, cruiseSpeedKt: 438, fuelBurnKgH: 2700 },
  { icaoType: 'DC10', name: 'McDonnell Douglas DC-10-30', manufacturer: 'McDonnell Douglas', category: 'wide_body', rangeNm: 5800, capacityPax: 270, cruiseSpeedKt: 473, fuelBurnKgH: 7200 },

  // ───── BAE Systems / Avro ─────
  { icaoType: 'RJ70', name: 'British Aerospace Avro RJ70', manufacturer: 'BAE Systems', category: 'regional', rangeNm: 1600, capacityPax: 70, cruiseSpeedKt: 410, fuelBurnKgH: 1900 },
  { icaoType: 'RJ85', name: 'British Aerospace Avro RJ85', manufacturer: 'BAE Systems', category: 'regional', rangeNm: 1500, capacityPax: 85, cruiseSpeedKt: 410, fuelBurnKgH: 2000 },
  { icaoType: 'RJ1H', name: 'British Aerospace Avro RJ100', manufacturer: 'BAE Systems', category: 'regional', rangeNm: 1500, capacityPax: 100, cruiseSpeedKt: 410, fuelBurnKgH: 2100 },
  { icaoType: 'BA46', name: 'British Aerospace BAe 146', manufacturer: 'BAE Systems', category: 'regional', rangeNm: 1500, capacityPax: 100, cruiseSpeedKt: 410, fuelBurnKgH: 2100 },

  // ───── General Aviation / Trainer ─────
  { icaoType: 'C152', name: 'Cessna 152', manufacturer: 'Cessna', category: 'ga', rangeNm: 415, capacityPax: 2, cruiseSpeedKt: 107, fuelBurnKgH: 22 },
  { icaoType: 'C172', name: 'Cessna 172 Skyhawk', manufacturer: 'Cessna', category: 'ga', rangeNm: 640, capacityPax: 4, cruiseSpeedKt: 122, fuelBurnKgH: 30 },
  { icaoType: 'C182', name: 'Cessna 182 Skylane', manufacturer: 'Cessna', category: 'ga', rangeNm: 915, capacityPax: 4, cruiseSpeedKt: 145, fuelBurnKgH: 50 },
  { icaoType: 'C208', name: 'Cessna 208 Caravan', manufacturer: 'Cessna', category: 'ga', rangeNm: 1070, capacityPax: 9, cruiseSpeedKt: 186, fuelBurnKgH: 220 },
  { icaoType: 'BE36', name: 'Beechcraft Bonanza A36', manufacturer: 'Beechcraft', category: 'ga', rangeNm: 920, capacityPax: 6, cruiseSpeedKt: 174, fuelBurnKgH: 65 },
  { icaoType: 'BE58', name: 'Beechcraft Baron 58', manufacturer: 'Beechcraft', category: 'ga', rangeNm: 1480, capacityPax: 6, cruiseSpeedKt: 200, fuelBurnKgH: 130 },
  { icaoType: 'PA28', name: 'Piper PA-28 Cherokee', manufacturer: 'Piper', category: 'ga', rangeNm: 522, capacityPax: 4, cruiseSpeedKt: 127, fuelBurnKgH: 28 },
  { icaoType: 'PA46', name: 'Piper PA-46 Malibu', manufacturer: 'Piper', category: 'ga', rangeNm: 1340, capacityPax: 6, cruiseSpeedKt: 213, fuelBurnKgH: 90 },
  { icaoType: 'SR22', name: 'Cirrus SR22', manufacturer: 'Cirrus', category: 'ga', rangeNm: 1207, capacityPax: 4, cruiseSpeedKt: 183, fuelBurnKgH: 60 },
  { icaoType: 'TBM9', name: 'Daher TBM 900', manufacturer: 'Daher', category: 'ga', rangeNm: 1730, capacityPax: 6, cruiseSpeedKt: 330, fuelBurnKgH: 180 },
];
