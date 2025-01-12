import { Service } from 'homebridge';
import { TuyaDeviceSchema } from '../device/TuyaDevice';
import BaseAccessory from './BaseAccessory';
import { configureActive } from './characteristic/Active';
import { configureLight } from './characteristic/Light';
import { configureCurrentTemperature } from './characteristic/CurrentTemperature';
import { configureRotationSpeed } from './characteristic/RotationSpeed';

const SCHEMA_CODE = {
  // Main controls
  POWER: ['switch'],
  // Flame A controls
  FLAME_A_SWITCH: ['flame_a_switch'],
  FLAME_A_BRIGHTNESS: ['flame_a_brightness'],
  // Flame B controls
  FLAME_B_SWITCH: ['flame_b_switch'],
  FLAME_B_EFFECT: ['flame_b_effect'],
  FLAME_B_BRIGHTNESS: ['flame_b_brightness'],
  // Fuel bed controls
  FUEL_SWITCH: ['fuel_switch'],
  FUEL_EFFECT: ['fuel_effect'],
  FUEL_BRIGHTNESS: ['fuel_brightness'],
  // Sound controls
  SOUND_SWITCH: ['sound_switch'],
  SOUND_TYPE: ['sound_type'],
  SOUND_VOLUME: ['sound_volume'],
  // Heater controls
  HEATER_SWITCH: ['heater_switch'],
  HEATER_TEMP: ['temperature_set'],
  HEATER_CURRENT_TEMP: ['temperature_current'],
  HEATER_SPEED: ['heater_speed'],
};

export default class FireplaceAccessory extends BaseAccessory {

  requiredSchema() {
    return [SCHEMA_CODE.POWER];
  }

  configureServices() {
    this.configureHeaterService();
    this.configureFlameAService();
    this.configureFlameBService();
    this.configureFuelBedService();
    this.configureSpeakerService();
  }

  private configureHeaterService(): Service {
    const service = this.accessory.getService(this.Service.HeaterCooler)
      || this.accessory.addService(this.Service.HeaterCooler, 'Heater');

    // Configure main heater controls
    configureActive(this, service, this.getSchema(...SCHEMA_CODE.HEATER_SWITCH));

    // Configure temperature controls
    configureCurrentTemperature(
      this,
      service,
      this.getSchema(...SCHEMA_CODE.HEATER_CURRENT_TEMP)
    );

    // Configure target temperature
    this.configureHeaterTemperature(service);

    // Configure fan speed
    configureRotationSpeed(
      this,
      service,
      this.getSchema(...SCHEMA_CODE.HEATER_SPEED)
    );

    // Set heater-only state
    this.configureHeaterState(service);

    return service;
  }

  private configureFlameAService(): Service {
    const service = this.accessory.getService('Flame A')
      || this.accessory.addService(this.Service.Lightbulb, 'Flame A', 'flame_a');

    configureLight(
      this,
      service,
      this.getSchema(...SCHEMA_CODE.FLAME_A_SWITCH),
      this.getSchema(...SCHEMA_CODE.FLAME_A_BRIGHTNESS)
    );

    return service;
  }

  private configureFlameBService(): Service {
    const service = this.accessory.getService('Flame B')
      || this.accessory.addService(this.Service.Lightbulb, 'Flame B', 'flame_b');

    // Configure as RGB light to handle different flame effects
    configureLight(
      this,
      service,
      this.getSchema(...SCHEMA_CODE.FLAME_B_SWITCH),
      this.getSchema(...SCHEMA_CODE.FLAME_B_BRIGHTNESS),
      undefined, // no temperature control
      this.getSchema(...SCHEMA_CODE.FLAME_B_EFFECT) // use effect as color control
    );

    return service;
  }

  private configureFuelBedService(): Service {
    const service = this.accessory.getService('Fuel Bed')
      || this.accessory.addService(this.Service.Lightbulb, 'Fuel Bed', 'fuel_bed');

    // Configure as RGB light to handle different fuel bed effects
    configureLight(
      this,
      service,
      this.getSchema(...SCHEMA_CODE.FUEL_SWITCH),
      this.getSchema(...SCHEMA_CODE.FUEL_BRIGHTNESS),
      undefined, // no temperature control
      this.getSchema(...SCHEMA_CODE.FUEL_EFFECT) // use effect as color control
    );

    return service;
  }

  private configureSpeakerService(): Service {
    const service = this.accessory.getService(this.Service.Speaker)
      || this.accessory.addService(this.Service.Speaker, 'Sound');

    // Configure speaker controls
    this.configureSpeakerControls(service);

    return service;
  }

  private configureHeaterTemperature(service: Service) {
    const tempSchema = this.getSchema(...SCHEMA_CODE.HEATER_TEMP);
    if (!tempSchema) return;

    service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .onGet(() => {
        const status = this.getStatus(tempSchema.code)!;
        return status.value as number;
      })
      .onSet(async (value) => {
        await this.sendCommands([
          { code: tempSchema.code, value: value as number }
        ]);
      })
      .setProps({
        minValue: 5,
        maxValue: 40,
        minStep: 1
      });
  }

  private configureHeaterState(service: Service) {
    // Set current state
    service.getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
      .onGet(() => {
        const active = this.getStatus(SCHEMA_CODE.HEATER_SWITCH[0])!;
        if (!active.value) {
          return this.Characteristic.CurrentHeaterCoolerState.INACTIVE;
        }
        return this.Characteristic.CurrentHeaterCoolerState.HEATING;
      });

    // Set target state to heat only
    service.getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [this.Characteristic.TargetHeaterCoolerState.HEAT]
      })
      .onGet(() => this.Characteristic.TargetHeaterCoolerState.HEAT)
      .onSet(() => {
        // Do nothing as we only support heating
      });
  }

  private configureSpeakerControls(service: Service) {
    const switchSchema = this.getSchema(...SCHEMA_CODE.SOUND_SWITCH);
    const volumeSchema = this.getSchema(...SCHEMA_CODE.SOUND_VOLUME);
    const typeSchema = this.getSchema(...SCHEMA_CODE.SOUND_TYPE);

    if (switchSchema) {
      service.getCharacteristic(this.Characteristic.Mute)
        .onGet(() => {
          const status = this.getStatus(switchSchema.code)!;
          return !(status.value as boolean);
        })
        .onSet(async (value) => {
          await this.sendCommands([
            { code: switchSchema.code, value: !value }
          ]);
        });
    }

    if (volumeSchema) {
      service.getCharacteristic(this.Characteristic.Volume)
        .onGet(() => {
          const status = this.getStatus(volumeSchema.code)!;
          return status.value as number;
        })
        .onSet(async (value) => {
          await this.sendCommands([
            { code: volumeSchema.code, value: value as number }
          ]);
        });
    }

    // Configure sound type selection
    if (typeSchema) {
      this.configureSoundTypeInput(service);
    }
  }

  private configureSoundTypeInput(service: Service) {
    // Add input source service for sound type selection
    const inputService = this.accessory.getService('Sound Type')
      || this.accessory.addService(this.Service.InputSource, 'Sound Type', 'sound_type');

    inputService
      .setCharacteristic(this.Characteristic.ConfiguredName, 'Sound Type')
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.OTHER)
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.Characteristic.CurrentVisibilityState, this.Characteristic.CurrentVisibilityState.SHOWN);

    service.addLinkedService(inputService);

    const schema = this.getSchema(...SCHEMA_CODE.SOUND_TYPE);
    if (!schema) return;

    service.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onGet(() => {
        const status = this.getStatus(schema.code)!;
        return status.value as number;
      })
      .onSet(async (value) => {
        await this.sendCommands([
          { code: schema.code, value: value as number }
        ]);
      });
  }
}