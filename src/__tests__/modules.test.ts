import { validateLoadout, EMPTY_LOADOUT, ACTIVE_SLOT_COUNT, PASSIVE_SLOT_COUNT } from '../types/modules';
import { MODULE_REGISTRY } from '../data/modules.data';

describe('validateLoadout', () => {
  it('validates empty loadout', () => {
    const result = validateLoadout(EMPTY_LOADOUT, MODULE_REGISTRY);
    expect(result.valid).toBe(true);
  });

  it('accepts valid active module in slot', () => {
    const loadout = {
      ...EMPTY_LOADOUT,
      activeSlots: [
        { defId: 'mod_shield_burst', upgradeLevel: 0 },
        null,
        null,
      ],
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(true);
  });

  it('accepts valid passive core', () => {
    const loadout = {
      ...EMPTY_LOADOUT,
      passiveSlots: [{ defId: 'core_overclock', upgradeLevel: 0 }],
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(true);
  });

  it('rejects unknown module id', () => {
    const loadout = {
      ...EMPTY_LOADOUT,
      activeSlots: [
        { defId: 'mod_does_not_exist', upgradeLevel: 0 },
        null,
        null,
      ],
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(false);
    expect((result as any).errors).toContain('Unknown module id: mod_does_not_exist');
  });

  it('rejects passive core in active slot', () => {
    const loadout = {
      ...EMPTY_LOADOUT,
      activeSlots: [
        { defId: 'core_overclock', upgradeLevel: 0 },
        null,
        null,
      ],
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(false);
  });

  it('rejects active module in passive slot', () => {
    const loadout = {
      ...EMPTY_LOADOUT,
      passiveSlots: [{ defId: 'mod_shield_burst', upgradeLevel: 0 }],
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate modules', () => {
    const loadout = {
      ...EMPTY_LOADOUT,
      activeSlots: [
        { defId: 'mod_shield_burst', upgradeLevel: 0 },
        { defId: 'mod_shield_burst', upgradeLevel: 0 },
        null,
      ],
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(false);
  });

  it('rejects upgrade level out of range', () => {
    const def = MODULE_REGISTRY.get('mod_shield_burst')!;
    const loadout = {
      ...EMPTY_LOADOUT,
      activeSlots: [
        { defId: 'mod_shield_burst', upgradeLevel: def.maxUpgradeLevel + 1 },
        null,
        null,
      ],
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(false);
  });

  it('rejects wrong number of active slots', () => {
    const loadout = {
      ...EMPTY_LOADOUT,
      activeSlots: [null, null], // only 2 instead of 3
    };
    const result = validateLoadout(loadout, MODULE_REGISTRY);
    expect(result.valid).toBe(false);
  });
});
