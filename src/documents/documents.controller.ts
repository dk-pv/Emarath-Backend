import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DocumentResponse } from './dto/document-response.dto';

/** Thin by design: validation is the DTO's job, storage and scoping the service's. */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * POST /api/documents — upload a company-wide document (DOC-02.1). Multipart: the `file`
   * part is buffered in memory (multer default) and handed to the shared StorageService; the
   * text parts (File name, Select Users, category) validate through CreateDocumentDto.
   */
  // ponytail: memory-buffered, so the size limit is enforced by StorageService.put
  // after the body is read (the single authoritative gate). Add a multer
  // limits.fileSize edge cap (via MulterModule.registerAsync off storage config) if
  // this foundation faces untrusted upload scale.
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateDocumentDto,
  ): Promise<DocumentResponse> {
    return this.documents.create(file, dto);
  }
}
