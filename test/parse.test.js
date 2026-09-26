/**
 * Contract tests for parse.js on synthetic trip recaps. Run: node --test test/
 * The builders copy the tab layout of a copied FedEx trip recap page. The data is made up:
 * the repository is public, so never put a real recap here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTripPaste } = require('../parse.js');

// ---------- builders ----------

const row = (...cells) => cells.join('\t');
/** A flight row: flight, H flag, date, org-dst, -, dep, arr, block, turn, layover, duty, -, meals. */
const flight = (no, date, od, dep, blk, { h = '', turn = '', lo = '', duty = '', meals = '' } = {}) =>
  row(no, h, date, od, '', dep, '', blk, turn, lo, duty, '', meals);
/** A ground transport or hotel row: first cell empty, then type, -, date, -, start, end, "phone name". */
const extra = (type, date, t1, t2, phoneName) => row('', type, '', date, '', t1, t2, phoneName);

function recap({ header = 'Trip 901 MEM 77 02OCT26 FAKE', totals = 'Block 12:10 Pay 15:00', legs, crew = [], fares = [] }) {
  return [
    'Trip Recap',
    header,
    totals,
    '',
    row('R', 'Flight', 'H', 'Date', 'Org-Dst', 'x', 'Dep', 'Arr', 'Blk', 'Turn', 'Lyovr', 'Duty', 'Meals'),
    ...legs,
    'T O T A L S',
    '',
    row('Pos', 'Asg', 'x', 'Emp', 'Name'),
    ...crew,
    '',
    ...(fares.length ? ['Deadhead Fares', ...fares] : []),
  ].join('\n');
}

const LEGS = [
  flight('5038', '02OCT26', 'MEM-CGN', '0900', '841', { turn: '2304', lo: '2134', duty: '1011', meals: 'BH/DH' }),
  extra('GT', '02OCT26', '1741', '1811', '+1-800-555-0100 ACME CARS'),
  extra('HOTEL', '02OCT26', '', '', '+49-221-555-0199 TEST HOTEL'),
  extra('GT', '03OCT26', '1500', '1545', '+1-800-555-0100 ACME CARS'),
  flight('UA123', '03OCT26', 'CGN-MEM', '1700', '329', { h: 'X' }),
];
const CREW = [row('CAP', 'CMU', '', '111111', 'DOE JOHN'), row('F/O', '', '', '222222', 'ROE JANE')];

const parse = extra => parseTripPaste(recap({ legs: LEGS, crew: CREW, ...extra }));
const code = text => { try { parseTripPaste(text); } catch (e) { return e.code; } return 'no error'; };

// ---------- header and totals ----------

test('a trip header: id, base, and equipment come from it', () => {
  const t = parse();
  assert.deepEqual([t.id, t.base, t.eq], ['901', 'MEM', '77']);
});

test('the Block/Pay line: both totals are the planned and actual pair', () => {
  const t = parse();
  assert.deepEqual(t.block, ['12:10', '12:10']);
  assert.deepEqual(t.pay, ['15:00', '15:00']);
});

test('report is 60 min before the first departure, release 30 min after the last arrival', () => {
  const t = parse();
  assert.equal(t.show, '2026-10-02T08:00:00Z');
  assert.equal(t.end, '2026-10-03T20:59:00Z'); // 17:00 + 3:29 block + 0:30
  assert.deepEqual(t.away, ['36:59', '36:59']);
});

// ---------- legs ----------

test('a flight row: departure time plus block gives the arrival, in Zulu', () => {
  const f = parse().items[0];
  assert.deepEqual(f, {
    t: 'f', no: '5038', o: 'MEM', d: 'CGN', s: ['2026-10-02T09:00:00Z', '2026-10-02T17:41:00Z'],
    blk: ['8:41', '8:41'], turn: ['23:04', '23:04'], duty: ['10:11', '10:11'], lo: ['21:34', '21:34'], meals: 'BH/DH',
  });
});

test('an H flag of X or Y: the leg is a deadhead; empty columns add no fields', () => {
  const f = parse().items[2];
  assert.equal(f.dh, true);
  assert.equal(f.no, 'UA123');
  for (const k of ['turn', 'duty', 'lo', 'meals']) assert.equal(k in f, false, k);
  const y = parseTripPaste(recap({ legs: [flight('UA9', '02OCT26', 'MEM-ORD', '1200', '100', { h: 'Y' })] }));
  assert.equal(y.items[0].dh, true);
});

test('GT, HOTEL, GT after a leg: one layover at the leg destination, hotel from the HOTEL row', () => {
  const l = parse().items[1];
  assert.deepEqual(l, {
    t: 'l', stn: 'CGN', hotel: 'TEST HOTEL', ph: '+49-221-555-0199',
    in: '2026-10-02T18:11:00Z', out: '2026-10-03T15:00:00Z',
    gin: { co: 'ACME CARS', ph: '+1-800-555-0100', a: '2026-10-02T17:41:00Z', b: '2026-10-02T18:11:00Z' },
    gout: { co: 'ACME CARS', ph: '+1-800-555-0100', a: '2026-10-03T15:00:00Z', b: '2026-10-03T15:45:00Z' },
  });
});

test('rows after T O T A L S: they are not legs', () => {
  const t = parse();
  assert.deepEqual(t.items.map(i => i.t), ['f', 'l', 'f']);
});

// ---------- crew and fares ----------

test('crew rows: CAP and F/O map to seats, LAST FIRST becomes First Last', () => {
  assert.deepEqual(parse().crew, [
    { seat: 'Captain', code: 'CMU', id: '111111', name: 'John Doe' },
    { seat: 'First officer', code: '', id: '222222', name: 'Jane Roe' },
  ]);
});

test('a Deadhead Fares section: the row after it is one fare', () => {
  assert.deepEqual(parse({ fares: [row('UA', 'CGN-MEM', 'Y', '500.00')] }).fares,
    [{ al: 'UA', od: 'CGN-MEM', cls: 'Y', amt: '500.00' }]);
  assert.deepEqual(parse().fares, []);
});

// ---------- errors ----------

test('missing parts: each throws its own code', () => {
  assert.equal(code('hello'), 'no_trip_line');
  assert.equal(code('Trip 901 MEM 77 02OCT26'), 'no_block_pay');
  assert.equal(code('Trip 901 MEM 77 02OCT26\nBlock 1:00 Pay 2:00'), 'no_table');
  assert.equal(code(recap({ legs: [] })), 'no_flights');
});

test('Windows line endings: the paste parses the same', () => {
  const text = recap({ legs: LEGS, crew: CREW });
  assert.deepEqual(parseTripPaste(text.replace(/\n/g, '\r\n')), parseTripPaste(text));
});
