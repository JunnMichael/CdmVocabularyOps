import { AfterViewInit, Component, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTable, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConceptMapping, ConceptMappingService } from '../concept-mapping.service';
import { TableDataSource } from '@commonshcs/docs';
import { VocabulariesService, Vocabulary } from '../vocabularies.service';
import { BehaviorSubject, Observable, first, map, merge, mergeAll, mergeMap, of, reduce, startWith, switchMap, tap } from 'rxjs';
import { SourceConcept, SourceDbService } from '../../source-db.service';
import { VocabularyMapping, VocabularyMappingService } from '../vocabulary-mapping.service';
import { SmartSearchComponent } from './smart-search/smart-search.component';
import { trigger, state, style, transition, animate } from '@angular/animations';

@Component({
  selector: 'app-verify-mappings',
  standalone: true,
  imports: [
    SmartSearchComponent,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    MatListModule,
    MatAutocompleteModule,
    MatButtonToggleModule,
    MatInputModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDialogModule,
    MatProgressBarModule,
    MatTooltipModule,
    ReactiveFormsModule,
    CommonModule
  ],
  templateUrl: './verify-mappings.component.html',
  styleUrls: ['./verify-mappings.component.css'],
  animations: [
    trigger('detailExpand', [
      state('collapsed', style({height: '0px', minHeight: '0'})),
      state('expanded', style({height: '*'})),
      transition('expanded <=> collapsed', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
    ]),
  ],
})
export class VerifyMappingsComponent implements AfterViewInit, OnDestroy {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatTable) table!: MatTable<ConceptMapping>;

  vocabularyControl = new FormControl('', [Validators.required, this.validVocabulary()])
  formGroup = new FormGroup({
    'vocabulary': this.vocabularyControl
  })
  formInProgress = false
  expanded: ConceptMapping | null = null
  displayedColumns: string[] = [
    'conceptFrequency',
    'sourceCode',
    'sourceName',
    'similarityScore',
    'athenaConceptName',
    'athenaVocabularyId'
  ]
  get columnsToDisplayWithExpand() {
    return ['expand', ...this.displayedColumns]
  }
  count = this.conceptMappingService.count()
  dataSource!: TableDataSource<ConceptMapping>
  vocabularies = this.vocabulariesService.valueChanges({
    where: [['isSource', '==', true]]
  })
  vocabularyIds = new BehaviorSubject<string[]>([])
  loadedVocabulary = new BehaviorSubject<string | null>(null)

  constructor(
    private conceptMappingService: ConceptMappingService,
    private vocabulariesService: VocabulariesService,
    private vocabularyMappingService: VocabularyMappingService,
    private sourceDbService: SourceDbService,
  ) { }

  ngAfterViewInit(): void {
    this.dataSource = new TableDataSource(
      this.conceptMappingService,
    )
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
    this.table.dataSource = this.dataSource;
  }

  subscriptions = [

    this.vocabularies.pipe(
      map(vs => (vs ?? []).map(v => v.id!))
    ).subscribe(this.vocabularyIds),

    this.loadedVocabulary.pipe(
      switchMap(vocabularyId => this.vocabularyMappingService.valueChanges({
        where: [['vocabularyId', '==', vocabularyId]]
      }).pipe(map(vs => [vocabularyId, vs] as [string, VocabularyMapping[]]))),
      switchMap(([vid, vs]) => vs ? merge(...vs.map(v => this.sourceDbService.loadConcepts({
          database: v.databaseName,
          table: v.tableName,
          conceptCode: v.conceptCode,
          conceptName: v.conceptName
        }).pipe(
          first(),
          map(cs => [vid, v, cs] as [string, VocabularyMapping, SourceConcept[]])
        )
      )).pipe(
        reduce(({ m }, [vid, v, cs]) => {
          cs.forEach(c => {
            const k = (c.sourceCode ?? [...c.sourceName!][0])!.toString()
            if (k in m) {
              m[k].conceptFrequency! += c.frequency
              m[k].vocabularyMappings!.push({
                database: v.databaseName,
                table: v.tableName,
                conceptCode: v.conceptCode,
                conceptName: v.conceptName
              })
              if (v.conceptName) {
                m[k].sourceName = [...new Set([...m[k].sourceName!])]
              }
            } else {
              m[k] = {
                sourceCode: c.sourceCode,
                sourceName: c.sourceName ? [...c.sourceName].map(n => n!.toString()) : [],
                vocabularyMappings: [{
                  database: v.databaseName,
                  table: v.tableName,
                  conceptCode: v.conceptCode,
                  conceptName: v.conceptName
                }],
                conceptFrequency: c.frequency,
                sourceVocabularyId: v.vocabularyId,
              }
            }
          })
          return { vid, m } as { vid: string, m: { [key: string]: Partial<ConceptMapping> } }
        }, { vid: '', m: {} } as { vid: string, m: { [key: string]: Partial<ConceptMapping> } }),
      ) : of()),
      mergeMap(({ vid, m: cs }) => {
        const updates = Object.entries(cs).map(([k, c]) => {
          return this.conceptMappingService.updateById({
            id: this.conceptMappingService.compositeKey({
              vocabularyId: vid,
              conceptCodeOrName: k,
            }),
            partial: c
          })
        })
        this.formInProgress = false
        return merge(updates)
      }),
      mergeAll(),
    ).subscribe()
  ]

  ngOnDestroy(): void {
    throw new Error('Method not implemented.');
  }

  loadConcepts() {
    this.formInProgress = true
    setTimeout(() => this.loadedVocabulary.next(this.vocabularyControl.value))
  }

  searchConcepts(row: ConceptMapping) { }

  vocabularyString(vocabulary: Vocabulary) {
    const nameString = vocabulary.name ? ` - ${vocabulary.name}` : ''
    const versionString = vocabulary.version ? ` - ${vocabulary.version}` : ''
    return `${vocabulary.id}${nameString}${versionString}`
  }

  toggleRow(row: ConceptMapping) {
    if (this.expanded?.id === row.id) {
      this.expanded = null
    } else {
      this.expanded = row
    }
  }

  validVocabulary(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      return this.vocabularyIds?.value.includes(control.value) ? null : { invalidId: { value: control.value } }
    };
  }

  formatSourceName(ns: Set<string>): string {
    if (ns.size === 1) {
      return [...ns][0]
    } else {
      return [...ns].join(', ')
    }
  }
}
