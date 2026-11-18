// The Arabic comparison page reads Arabic for every visitor, whatever their
// interface language, and marketing pages never load a dashboard catalog.

import type { MessageVariables } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { marketing_arabicseo_comparison_arabicstatus } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_arabicstatus';
import { marketing_arabicseo_comparison_bestfor } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_bestfor';
import { marketing_arabicseo_comparison_choosewhen } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_choosewhen';
import { marketing_arabicseo_comparison_criteriablocksbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriablocksbody';
import { marketing_arabicseo_comparison_criteriablockstitle } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriablockstitle';
import { marketing_arabicseo_comparison_criteriacostbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriacostbody';
import { marketing_arabicseo_comparison_criteriacosttitle } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriacosttitle';
import { marketing_arabicseo_comparison_criteriaheading } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriaheading';
import { marketing_arabicseo_comparison_criteriamixedbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriamixedbody';
import { marketing_arabicseo_comparison_criteriamixedtitle } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriamixedtitle';
import { marketing_arabicseo_comparison_criteriaownershipbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriaownershipbody';
import { marketing_arabicseo_comparison_criteriaownershiptitle } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriaownershiptitle';
import { marketing_arabicseo_comparison_criteriarolloutbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriarolloutbody';
import { marketing_arabicseo_comparison_criteriarollouttitle } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriarollouttitle';
import { marketing_arabicseo_comparison_criteriaworkflowbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriaworkflowbody';
import { marketing_arabicseo_comparison_criteriaworkflowtitle } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_criteriaworkflowtitle';
import { marketing_arabicseo_comparison_disclosure } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_disclosure';
import { marketing_arabicseo_comparison_eyebrow } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_eyebrow';
import { marketing_arabicseo_comparison_faqalternativeanswer } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqalternativeanswer';
import { marketing_arabicseo_comparison_faqalternativequestion } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqalternativequestion';
import { marketing_arabicseo_comparison_faqgitbookanswer } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqgitbookanswer';
import { marketing_arabicseo_comparison_faqgitbookquestion } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqgitbookquestion';
import { marketing_arabicseo_comparison_faqheading } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqheading';
import { marketing_arabicseo_comparison_faqhostinganswer } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqhostinganswer';
import { marketing_arabicseo_comparison_faqhostingquestion } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqhostingquestion';
import { marketing_arabicseo_comparison_faqmintlifyanswer } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqmintlifyanswer';
import { marketing_arabicseo_comparison_faqmintlifyquestion } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqmintlifyquestion';
import { marketing_arabicseo_comparison_faqtranslationanswer } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqtranslationanswer';
import { marketing_arabicseo_comparison_faqtranslationquestion } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_faqtranslationquestion';
import { marketing_arabicseo_comparison_finalbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_finalbody';
import { marketing_arabicseo_comparison_finalheading } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_finalheading';
import { marketing_arabicseo_comparison_heading } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_heading';
import { marketing_arabicseo_comparison_intro } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_intro';
import { marketing_arabicseo_comparison_methodbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_methodbody';
import { marketing_arabicseo_comparison_methodheading } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_methodheading';
import { marketing_arabicseo_comparison_operatingmodel } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_operatingmodel';
import { marketing_arabicseo_comparison_optionsheading } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_optionsheading';
import { marketing_arabicseo_comparison_ourproduct } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_ourproduct';
import { marketing_arabicseo_comparison_platform } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_platform';
import { marketing_arabicseo_comparison_recommendationaibody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationaibody';
import { marketing_arabicseo_comparison_recommendationailabel } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationailabel';
import { marketing_arabicseo_comparison_recommendationapibody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationapibody';
import { marketing_arabicseo_comparison_recommendationapilabel } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationapilabel';
import { marketing_arabicseo_comparison_recommendationengineeringbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationengineeringbody';
import { marketing_arabicseo_comparison_recommendationengineeringlabel } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationengineeringlabel';
import { marketing_arabicseo_comparison_recommendationgitbookbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationgitbookbody';
import { marketing_arabicseo_comparison_recommendationgitbooklabel } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationgitbooklabel';
import { marketing_arabicseo_comparison_recommendationheading } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationheading';
import { marketing_arabicseo_comparison_recommendationproductbody } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationproductbody';
import { marketing_arabicseo_comparison_recommendationproductlabel } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_recommendationproductlabel';
import { marketing_arabicseo_comparison_reviewedon } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_reviewedon';
import { marketing_arabicseo_comparison_tablecaption } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_tablecaption';
import { marketing_arabicseo_comparison_watchfor } from '@nibleaf/i18n/messages/marketing_arabicseo_comparison_watchfor';
import { marketing_arabicseo_cta_checkexistinghtml } from '@nibleaf/i18n/messages/marketing_arabicseo_cta_checkexistinghtml';
import { marketing_arabicseo_cta_startfree } from '@nibleaf/i18n/messages/marketing_arabicseo_cta_startfree';
import { marketing_arabicseo_platform_apidog_arabic } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_apidog_arabic';
import { marketing_arabicseo_platform_apidog_bestfor } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_apidog_bestfor';
import { marketing_arabicseo_platform_apidog_caveat } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_apidog_caveat';
import { marketing_arabicseo_platform_apidog_model } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_apidog_model';
import { marketing_arabicseo_platform_apidog_summary } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_apidog_summary';
import { marketing_arabicseo_platform_docusaurus_arabic } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_docusaurus_arabic';
import { marketing_arabicseo_platform_docusaurus_bestfor } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_docusaurus_bestfor';
import { marketing_arabicseo_platform_docusaurus_caveat } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_docusaurus_caveat';
import { marketing_arabicseo_platform_docusaurus_model } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_docusaurus_model';
import { marketing_arabicseo_platform_docusaurus_summary } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_docusaurus_summary';
import { marketing_arabicseo_platform_gitbook_arabic } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_gitbook_arabic';
import { marketing_arabicseo_platform_gitbook_bestfor } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_gitbook_bestfor';
import { marketing_arabicseo_platform_gitbook_caveat } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_gitbook_caveat';
import { marketing_arabicseo_platform_gitbook_model } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_gitbook_model';
import { marketing_arabicseo_platform_gitbook_summary } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_gitbook_summary';
import { marketing_arabicseo_platform_mintlify_arabic } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mintlify_arabic';
import { marketing_arabicseo_platform_mintlify_bestfor } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mintlify_bestfor';
import { marketing_arabicseo_platform_mintlify_caveat } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mintlify_caveat';
import { marketing_arabicseo_platform_mintlify_model } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mintlify_model';
import { marketing_arabicseo_platform_mintlify_summary } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mintlify_summary';
import { marketing_arabicseo_platform_mkdocs_arabic } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mkdocs_arabic';
import { marketing_arabicseo_platform_mkdocs_bestfor } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mkdocs_bestfor';
import { marketing_arabicseo_platform_mkdocs_caveat } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mkdocs_caveat';
import { marketing_arabicseo_platform_mkdocs_model } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mkdocs_model';
import { marketing_arabicseo_platform_mkdocs_summary } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_mkdocs_summary';
import { marketing_arabicseo_platform_nibleaf_arabic } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_nibleaf_arabic';
import { marketing_arabicseo_platform_nibleaf_bestfor } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_nibleaf_bestfor';
import { marketing_arabicseo_platform_nibleaf_caveat } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_nibleaf_caveat';
import { marketing_arabicseo_platform_nibleaf_model } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_nibleaf_model';
import { marketing_arabicseo_platform_nibleaf_summary } from '@nibleaf/i18n/messages/marketing_arabicseo_platform_nibleaf_summary';
import { marketing_arabicseo_source_interfacelocale } from '@nibleaf/i18n/messages/marketing_arabicseo_source_interfacelocale';
import { marketing_arabicseo_source_languages } from '@nibleaf/i18n/messages/marketing_arabicseo_source_languages';
import { marketing_arabicseo_source_languagesversions } from '@nibleaf/i18n/messages/marketing_arabicseo_source_languagesversions';
import { marketing_arabicseo_source_official } from '@nibleaf/i18n/messages/marketing_arabicseo_source_official';
import { marketing_arabicseo_source_officialdocs } from '@nibleaf/i18n/messages/marketing_arabicseo_source_officialdocs';
import { marketing_arabicseo_source_pricing } from '@nibleaf/i18n/messages/marketing_arabicseo_source_pricing';
import { marketing_arabicseo_source_public } from '@nibleaf/i18n/messages/marketing_arabicseo_source_public';
import { scopedTranslate } from '@nibleaf/i18n/scoped';

export const ARABIC_SEO_MESSAGES = {
  'marketing.arabicSeo.comparison.arabicStatus': marketing_arabicseo_comparison_arabicstatus,
  'marketing.arabicSeo.comparison.bestFor': marketing_arabicseo_comparison_bestfor,
  'marketing.arabicSeo.comparison.chooseWhen': marketing_arabicseo_comparison_choosewhen,
  'marketing.arabicSeo.comparison.criteriaBlocksBody': marketing_arabicseo_comparison_criteriablocksbody,
  'marketing.arabicSeo.comparison.criteriaBlocksTitle': marketing_arabicseo_comparison_criteriablockstitle,
  'marketing.arabicSeo.comparison.criteriaCostBody': marketing_arabicseo_comparison_criteriacostbody,
  'marketing.arabicSeo.comparison.criteriaCostTitle': marketing_arabicseo_comparison_criteriacosttitle,
  'marketing.arabicSeo.comparison.criteriaHeading': marketing_arabicseo_comparison_criteriaheading,
  'marketing.arabicSeo.comparison.criteriaMixedBody': marketing_arabicseo_comparison_criteriamixedbody,
  'marketing.arabicSeo.comparison.criteriaMixedTitle': marketing_arabicseo_comparison_criteriamixedtitle,
  'marketing.arabicSeo.comparison.criteriaOwnershipBody': marketing_arabicseo_comparison_criteriaownershipbody,
  'marketing.arabicSeo.comparison.criteriaOwnershipTitle': marketing_arabicseo_comparison_criteriaownershiptitle,
  'marketing.arabicSeo.comparison.criteriaRolloutBody': marketing_arabicseo_comparison_criteriarolloutbody,
  'marketing.arabicSeo.comparison.criteriaRolloutTitle': marketing_arabicseo_comparison_criteriarollouttitle,
  'marketing.arabicSeo.comparison.criteriaWorkflowBody': marketing_arabicseo_comparison_criteriaworkflowbody,
  'marketing.arabicSeo.comparison.criteriaWorkflowTitle': marketing_arabicseo_comparison_criteriaworkflowtitle,
  'marketing.arabicSeo.comparison.disclosure': marketing_arabicseo_comparison_disclosure,
  'marketing.arabicSeo.comparison.eyebrow': marketing_arabicseo_comparison_eyebrow,
  'marketing.arabicSeo.comparison.faqAlternativeAnswer': marketing_arabicseo_comparison_faqalternativeanswer,
  'marketing.arabicSeo.comparison.faqAlternativeQuestion': marketing_arabicseo_comparison_faqalternativequestion,
  'marketing.arabicSeo.comparison.faqGitbookAnswer': marketing_arabicseo_comparison_faqgitbookanswer,
  'marketing.arabicSeo.comparison.faqGitbookQuestion': marketing_arabicseo_comparison_faqgitbookquestion,
  'marketing.arabicSeo.comparison.faqHeading': marketing_arabicseo_comparison_faqheading,
  'marketing.arabicSeo.comparison.faqHostingAnswer': marketing_arabicseo_comparison_faqhostinganswer,
  'marketing.arabicSeo.comparison.faqHostingQuestion': marketing_arabicseo_comparison_faqhostingquestion,
  'marketing.arabicSeo.comparison.faqMintlifyAnswer': marketing_arabicseo_comparison_faqmintlifyanswer,
  'marketing.arabicSeo.comparison.faqMintlifyQuestion': marketing_arabicseo_comparison_faqmintlifyquestion,
  'marketing.arabicSeo.comparison.faqTranslationAnswer': marketing_arabicseo_comparison_faqtranslationanswer,
  'marketing.arabicSeo.comparison.faqTranslationQuestion': marketing_arabicseo_comparison_faqtranslationquestion,
  'marketing.arabicSeo.comparison.finalBody': marketing_arabicseo_comparison_finalbody,
  'marketing.arabicSeo.comparison.finalHeading': marketing_arabicseo_comparison_finalheading,
  'marketing.arabicSeo.comparison.heading': marketing_arabicseo_comparison_heading,
  'marketing.arabicSeo.comparison.intro': marketing_arabicseo_comparison_intro,
  'marketing.arabicSeo.comparison.methodBody': marketing_arabicseo_comparison_methodbody,
  'marketing.arabicSeo.comparison.methodHeading': marketing_arabicseo_comparison_methodheading,
  'marketing.arabicSeo.comparison.operatingModel': marketing_arabicseo_comparison_operatingmodel,
  'marketing.arabicSeo.comparison.optionsHeading': marketing_arabicseo_comparison_optionsheading,
  'marketing.arabicSeo.comparison.ourProduct': marketing_arabicseo_comparison_ourproduct,
  'marketing.arabicSeo.comparison.platform': marketing_arabicseo_comparison_platform,
  'marketing.arabicSeo.comparison.recommendationAiBody': marketing_arabicseo_comparison_recommendationaibody,
  'marketing.arabicSeo.comparison.recommendationAiLabel': marketing_arabicseo_comparison_recommendationailabel,
  'marketing.arabicSeo.comparison.recommendationApiBody': marketing_arabicseo_comparison_recommendationapibody,
  'marketing.arabicSeo.comparison.recommendationApiLabel': marketing_arabicseo_comparison_recommendationapilabel,
  'marketing.arabicSeo.comparison.recommendationEngineeringBody': marketing_arabicseo_comparison_recommendationengineeringbody,
  'marketing.arabicSeo.comparison.recommendationEngineeringLabel': marketing_arabicseo_comparison_recommendationengineeringlabel,
  'marketing.arabicSeo.comparison.recommendationGitbookBody': marketing_arabicseo_comparison_recommendationgitbookbody,
  'marketing.arabicSeo.comparison.recommendationGitbookLabel': marketing_arabicseo_comparison_recommendationgitbooklabel,
  'marketing.arabicSeo.comparison.recommendationHeading': marketing_arabicseo_comparison_recommendationheading,
  'marketing.arabicSeo.comparison.recommendationProductBody': marketing_arabicseo_comparison_recommendationproductbody,
  'marketing.arabicSeo.comparison.recommendationProductLabel': marketing_arabicseo_comparison_recommendationproductlabel,
  'marketing.arabicSeo.comparison.reviewedOn': marketing_arabicseo_comparison_reviewedon,
  'marketing.arabicSeo.comparison.tableCaption': marketing_arabicseo_comparison_tablecaption,
  'marketing.arabicSeo.comparison.watchFor': marketing_arabicseo_comparison_watchfor,
  'marketing.arabicSeo.cta.checkExistingHtml': marketing_arabicseo_cta_checkexistinghtml,
  'marketing.arabicSeo.cta.startFree': marketing_arabicseo_cta_startfree,
  'marketing.arabicSeo.platform.apidog.arabic': marketing_arabicseo_platform_apidog_arabic,
  'marketing.arabicSeo.platform.apidog.bestFor': marketing_arabicseo_platform_apidog_bestfor,
  'marketing.arabicSeo.platform.apidog.caveat': marketing_arabicseo_platform_apidog_caveat,
  'marketing.arabicSeo.platform.apidog.model': marketing_arabicseo_platform_apidog_model,
  'marketing.arabicSeo.platform.apidog.summary': marketing_arabicseo_platform_apidog_summary,
  'marketing.arabicSeo.platform.docusaurus.arabic': marketing_arabicseo_platform_docusaurus_arabic,
  'marketing.arabicSeo.platform.docusaurus.bestFor': marketing_arabicseo_platform_docusaurus_bestfor,
  'marketing.arabicSeo.platform.docusaurus.caveat': marketing_arabicseo_platform_docusaurus_caveat,
  'marketing.arabicSeo.platform.docusaurus.model': marketing_arabicseo_platform_docusaurus_model,
  'marketing.arabicSeo.platform.docusaurus.summary': marketing_arabicseo_platform_docusaurus_summary,
  'marketing.arabicSeo.platform.gitbook.arabic': marketing_arabicseo_platform_gitbook_arabic,
  'marketing.arabicSeo.platform.gitbook.bestFor': marketing_arabicseo_platform_gitbook_bestfor,
  'marketing.arabicSeo.platform.gitbook.caveat': marketing_arabicseo_platform_gitbook_caveat,
  'marketing.arabicSeo.platform.gitbook.model': marketing_arabicseo_platform_gitbook_model,
  'marketing.arabicSeo.platform.gitbook.summary': marketing_arabicseo_platform_gitbook_summary,
  'marketing.arabicSeo.platform.mintlify.arabic': marketing_arabicseo_platform_mintlify_arabic,
  'marketing.arabicSeo.platform.mintlify.bestFor': marketing_arabicseo_platform_mintlify_bestfor,
  'marketing.arabicSeo.platform.mintlify.caveat': marketing_arabicseo_platform_mintlify_caveat,
  'marketing.arabicSeo.platform.mintlify.model': marketing_arabicseo_platform_mintlify_model,
  'marketing.arabicSeo.platform.mintlify.summary': marketing_arabicseo_platform_mintlify_summary,
  'marketing.arabicSeo.platform.mkdocs.arabic': marketing_arabicseo_platform_mkdocs_arabic,
  'marketing.arabicSeo.platform.mkdocs.bestFor': marketing_arabicseo_platform_mkdocs_bestfor,
  'marketing.arabicSeo.platform.mkdocs.caveat': marketing_arabicseo_platform_mkdocs_caveat,
  'marketing.arabicSeo.platform.mkdocs.model': marketing_arabicseo_platform_mkdocs_model,
  'marketing.arabicSeo.platform.mkdocs.summary': marketing_arabicseo_platform_mkdocs_summary,
  'marketing.arabicSeo.platform.nibleaf.arabic': marketing_arabicseo_platform_nibleaf_arabic,
  'marketing.arabicSeo.platform.nibleaf.bestFor': marketing_arabicseo_platform_nibleaf_bestfor,
  'marketing.arabicSeo.platform.nibleaf.caveat': marketing_arabicseo_platform_nibleaf_caveat,
  'marketing.arabicSeo.platform.nibleaf.model': marketing_arabicseo_platform_nibleaf_model,
  'marketing.arabicSeo.platform.nibleaf.summary': marketing_arabicseo_platform_nibleaf_summary,
  'marketing.arabicSeo.source.interfaceLocale': marketing_arabicseo_source_interfacelocale,
  'marketing.arabicSeo.source.languages': marketing_arabicseo_source_languages,
  'marketing.arabicSeo.source.languagesVersions': marketing_arabicseo_source_languagesversions,
  'marketing.arabicSeo.source.official': marketing_arabicseo_source_official,
  'marketing.arabicSeo.source.officialDocs': marketing_arabicseo_source_officialdocs,
  'marketing.arabicSeo.source.pricing': marketing_arabicseo_source_pricing,
  'marketing.arabicSeo.source.public': marketing_arabicseo_source_public,
} as const;

export type ArabicSeoMessageKey = keyof typeof ARABIC_SEO_MESSAGES;

const ARABIC: Locale = 'ar';

export const arabicSeoText = (key: ArabicSeoMessageKey, variables?: MessageVariables): string =>
  scopedTranslate(ARABIC_SEO_MESSAGES, key, variables, ARABIC);
