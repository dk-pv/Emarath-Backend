import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

const TAG_A = '00000000-0000-4000-8000-00000000000a';
const TAG_B = '00000000-0000-4000-8000-00000000000b';

async function messages(fields: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateLeadDto, {
    name: 'Ali',
    primaryPhone: '0501234567',
    ...fields,
  });
  const errors = await validate(dto);
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('CreateLeadDto — amounts and quantities fit their Decimal(12, 2) columns', () => {
  it.each([
    ['actualAmount', 'Actual Amount'],
    ['forecastedAmount', 'Forecasted Amount'],
    ['productQty', 'QTY'],
    ['product2Qty', 'QTY of Product 2'],
  ])('%s: accepts what the column holds exactly', async (field) => {
    for (const value of ['0', '1500', '1500.5', '1234567890.12']) {
      expect(await messages({ [field]: value })).toEqual([]);
    }
  });

  // Regression: an 11-digit value passed validation and failed the write with a 500; a third
  // decimal was silently rounded.
  it.each([
    ['actualAmount', 'Actual Amount'],
    ['forecastedAmount', 'Forecasted Amount'],
    ['productQty', 'QTY'],
    ['product2Qty', 'QTY of Product 2'],
  ])(
    '%s: refuses a value the column would overflow or round (400)',
    async (field, label) => {
      for (const value of ['12345678901', '10.005', '1e5']) {
        expect(await messages({ [field]: value })).toContain(
          `${label} must have at most 10 digits before and 2 after the decimal point`,
        );
      }
    },
  );

  it('names only the sign rule for a negative value', async () => {
    expect(await messages({ actualAmount: '-5' })).toEqual([
      'Actual Amount cannot be negative',
    ]);
  });
});

describe('CreateLeadDto — tags', () => {
  // Regression: the same tag twice failed the lead's unique (lead, tag) key with a 500.
  it('refuses the same tag twice (400) and accepts distinct ones', async () => {
    expect(await messages({ tagIds: [TAG_A, TAG_A] })).toContain(
      'each tag may be chosen once',
    );
    expect(await messages({ tagIds: [TAG_A, TAG_B] })).toEqual([]);
  });
});
