'use strict';

module.exports = {
    bacnetUnitMap: {
        0: "m²", // square meter
        1: "ft²", // square foot
        2: "mA", // milliampere
        3: "A", // ampere
        4: "Ω", // ohm
        5: "V", // volt
        6: "kV", // kilovolt
        7: "MV", // megavolt
        8: "VA", // volt ampere
        9: "kVA", // kilovolt ampere
        10: "MVA", // megavolt ampere
        11: "var", // volt ampere reactive
        12: "kvar", // kilovolt ampere reactive
        13: "Mvar", // megavolt ampere reactive
        14: "°", // degrees phase
        15: "PF", // power factor
        16: "J", // joule
        17: "kJ", // kilojoule
        18: "Wh", // watt hour
        19: "kWh", // kilowatt hour
        20: "BTU", // btu
        21: "therm", // therm
        22: "ton·h", // tons refrigeration hour
        23: "J/kg dry air", // joules per kilogram dry air
        24: "BTU/lb dry air", // btus per pound dry air
        25: "cycles/h", // cycles per hour
        26: "cycles/min", // cycles per minute
        27: "Hz", // hertz
        28: "g water/kg dry air", // grams of water per kilogram dry air
        29: "%RH", // percent relative humidity
        30: "mm", // millimeter
        31: "m", // meter
        32: "in", // inch
        33: "ft", // foot
        34: "W/ft²", // watts per square foot
        35: "W/m²", // watts per square meter
        36: "lm", // lumen
        37: "lx", // lux
        38: "fc", // footcandles
        39: "kg", // kilogram
        40: "lb", // pound
        41: "t", // metric ton
        42: "kg/s", // kilograms per second
        43: "kg/min", // kilograms per minute
        44: "kg/h", // kilograms per hour
        45: "lb/min", // pounds per minute
        46: "lb/h", // pounds per hour
        47: "W", // watt
        48: "kW", // kilowatt
        49: "MW", // megawatt
        50: "BTU/h", // btus per hour
        51: "hp", // horsepower
        52: "tons", // tons refrigeration
        53: "Pa", // pascal
        54: "kPa", // kilopascal
        55: "bar", // bar
        56: "psi", // pounds per square inch
        57: "cm H₂O", // centimeters of water
        58: "in H₂O", // inches of water
        59: "mmHg", // millimeters of mercury
        60: "cmHg", // centimeters of mercury
        61: "inHg", // inches of mercury
        62: "°C", // celsius
        63: "K", // kelvin
        64: "°F", // fahrenheit
        65: "°C·d", // degree days celsius
        66: "°F·d", // degree days fahrenheit
        67: "y", // year
        68: "mo", // julian month
        69: "wk", // week
        70: "d", // day
        71: "h", // hour
        72: "min", // minute
        73: "s", // second
        74: "m/s", // meters per second
        75: "km/h", // kilometers per hour
        76: "ft/s", // feet per second
        77: "ft/min", // feet per minute
        78: "mph", // miles per hour
        79: "ft³", // cubic foot
        80: "m³", // cubic meter
        81: "gal (UK)", // imperial gallon
        82: "L", // liter
        83: "gal (US)", // gallon
        84: "ft³/min", // cubic feet per minute
        85: "m³/s", // cubic meters per second
        86: "gal/min (UK)", // imperial gallons per minute
        87: "L/s", // liters per second
        88: "L/min", // liters per minute
        89: "gal/min (US)", // gallons per minute
        90: "°", // degrees angular
        91: "°C/h", // degrees celsius per hour
        92: "°C/min", // degrees celsius per minute
        93: "°F/h", // degrees fahrenheit per hour
        94: "°F/min", // degrees fahrenheit per minute
        95: null, // null
        96: "ppm", // parts per million
        97: "ppb", // parts per billion
        98: "%", // percent
        99: "%/s", // percent per second
        100: "/min", // per minute
        101: "/s", // per second
        102: "psi/°F", // psi per degree fahrenheit
        103: "rad", // radian
        104: "rpm", // revolutions per minute
        115: "in²", // square inch
        116: "cm²", // square centimeter
        117: "BTU/lb", // btus per pound
        118: "cm", // centimeter
        119: "lb/s", // pounds per second
        120: "°F", // fahrenheit degrees
        121: "K", // kelvin degrees
        122: "kΩ", // kilohm
        123: "MΩ", // megohm
        124: "mV", // millivolt
        125: "kJ/kg", // kilojoules per kilogram
        126: "MJ", // megajoule
        127: "J/K", // joules per degree kelvin
        128: "J/(kg·K)", // joules per kilogram degree kelvin
        129: "kHz", // kilohertz
        130: "MHz", // megahertz
        131: "/h", // per hour
        132: "mW", // milliwatt
        133: "hPa", // hectopascal
        134: "mbar", // millibar
        135: "m³/h", // cubic meters per hour
        136: "L/h", // liters per hour
        137: "kWh/m²", // kilowatt hours per square meter
        138: "kWh/ft²", // kilowatt hours per square foot
        139: "MJ/m²", // megajoules per square meter
        140: "MJ/ft²", // megajoules per square foot
        141: "W/(m²·K)", // watts per square meter degree kelvin
        142: "ft³/s", // cubic feet per second
        143: "%/ft", // percent obscuration per foot
        144: "%/m", // percent obscuration per meter
        145: "mΩ", // milliohm
        146: "MWh", // megawatt hour
        147: "kBTU", // kilobtu
        148: "MBTU", // megabtu
        149: "kJ/(kg dry air)", // kilojoules per kilogram dry air
        150: "MJ/(kg dry air)", // megajoules per kilogram dry air
        151: "kJ/K", // kilojoules per degree kelvin
        152: "MJ/K", // megajoules per degree kelvin
        153: "N", // newton
        154: "g/s", // grams per second
        155: "g/min", // grams per minute
        156: "t/h", // metric tons per hour
        157: "kBTU/h", // kilobtus per hour
        158: "0.01s", // hundredths second
        159: "ms", // millisecond
        160: "N·m", // newton meter
        161: "mm/s", // millimeters per second
        162: "mm/min", // millimeters per minute
        163: "m/min", // meters per minute
        164: "m/h", // meters per hour
        165: "m³/min", // cubic meters per minute
        166: "m/s²", // meters per second squared
        167: "A/m", // amperes per meter
        168: "A/m²", // amperes per square meter
        169: "A·m²", // ampere square meter
        170: "F", // farad
        171: "H", // henry
        172: "Ω·m", // ohm meter
        173: "S", // siemens
        174: "S/m", // siemens per meter
        175: "T", // tesla
        176: "V/K", // volts per degree kelvin
        177: "V/m", // volts per meter
        178: "Wb", // weber
        179: "cd", // candela
        180: "cd/m²", // candelas per square meter
        181: "K/h", // degrees kelvin per hour
        182: "K/min", // degrees kelvin per minute
        183: "J·s", // joule second
        184: "rad/s", // radians per second
        185: "m²/N", // square meters per newton
        186: "kg/m³", // kilograms per cubic meter
        187: "N·s", // newton second
        188: "N/m", // newtons per meter
        189: "W/(m·K)", // watts per meter degree kelvin
    }
}