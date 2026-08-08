import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import {
  DocumentListResponse,
  DocumentResponse,
} from './dto/document-response.dto';
import {
  BulkActionResponse,
  BulkDeleteDocumentsDto,
} from './dto/bulk-delete-documents.dto';

/** Thin by design: validation is the DTO's job, storage and scoping the service's. */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** GET /api/documents — one scoped page of documents plus the total (DOC-03.1). */
  @Get()
  list(@Query() query: ListDocumentsQueryDto): Promise<DocumentListResponse> {
    return this.documents.list(query);
  }

  /** GET /api/documents/:id — one scoped document, loaded by the Edit drawer (DOC-04.1). */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentResponse> {
    return this.documents.findById(id);
  }

  /** PATCH /api/documents/:id — rename and/or change access (DOC-04.1). */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResponse> {
    return this.documents.update(id, dto);
  }

  /** DELETE /api/documents/:id — permanently remove the document and its file (DOC-05.1). */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.documents.remove(id);
  }

  /**
   * POST /api/documents/bulk/delete — permanently remove the selected documents (DOC-08.1).
   * POST (not DELETE) because it carries a body and returns a per-item result; 200, as it
   * acts on existing documents rather than creating one.
   */
  @Post('bulk/delete')
  @HttpCode(200)
  bulkDelete(@Body() dto: BulkDeleteDocumentsDto): Promise<BulkActionResponse> {
    return this.documents.bulkDelete(dto);
  }

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
