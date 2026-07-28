import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CheckInRecord,
  GpsService,
  GpsPinRecord,
  GpsSummaryRecord,
  LocationPointRecord,
} from './gps.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { RecordLocationPointDto } from './dto/record-location-point.dto';
import { GpsSummaryFilterDto } from './dto/gps-summary-filter.dto';

/** Thin by design: validation is the DTO's job, attribution the service's. */
@Controller('gps')
export class GpsController {
  constructor(private readonly gps: GpsService) {}

  /** POST /api/gps/check-ins — record a field check-in (GPS-02.1). */
  @Post('check-ins')
  checkIn(@Body() dto: CheckInDto): Promise<CheckInRecord> {
    return this.gps.checkIn(dto);
  }

  /** PATCH /api/gps/check-ins/:id/check-out — close an open check-in (GPS-02.1). */
  @Patch('check-ins/:id/check-out')
  checkOut(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckOutDto,
  ): Promise<CheckInRecord> {
    return this.gps.checkOut(id, dto);
  }

  /** POST /api/gps/location-points — record a passive tracking point (GPS-03.1). */
  @Post('location-points')
  recordPoint(
    @Body() dto: RecordLocationPointDto,
  ): Promise<LocationPointRecord> {
    return this.gps.recordPoint(dto);
  }

  /** GET /api/gps/summary — get GPS activity KPI counters (GPS-04.1). */
  @Get('summary')
  getSummary(@Query() dto: GpsSummaryFilterDto): Promise<GpsSummaryRecord> {
    return this.gps.getSummary(dto);
  }

  /** GET /api/gps/locations — get coordinate pins for map view (GPS-05.1). */
  @Get('locations')
  getLocations(@Query() dto: GpsSummaryFilterDto): Promise<GpsPinRecord[]> {
    return this.gps.getLocations(dto);
  }
}
