// The messages the sign-in, sign-up, verification and password pages use, with
// the shell they share with the dashboard (providers, language dialog, error
// state). They import these message modules instead of the whole catalog: see
// @nibleaf/i18n/scoped (MKT-001). `t` there accepts only these keys, so a page
// that needs another one fails to compile until it is added here.
import type { MessageVariables } from '@nibleaf/i18n/locale-state';
import { account_language } from '@nibleaf/i18n/messages/account_language';
import { account_language_description } from '@nibleaf/i18n/messages/account_language_description';
import { account_language_noresults } from '@nibleaf/i18n/messages/account_language_noresults';
import { account_language_search } from '@nibleaf/i18n/messages/account_language_search';
import { auth_backtosignin } from '@nibleaf/i18n/messages/auth_backtosignin';
import { auth_backtosite } from '@nibleaf/i18n/messages/auth_backtosite';
import { auth_brand_description } from '@nibleaf/i18n/messages/auth_brand_description';
import { auth_brand_domains } from '@nibleaf/i18n/messages/auth_brand_domains';
import { auth_brand_heading } from '@nibleaf/i18n/messages/auth_brand_heading';
import { auth_brand_hosting } from '@nibleaf/i18n/messages/auth_brand_hosting';
import { auth_brand_multilingual } from '@nibleaf/i18n/messages/auth_brand_multilingual';
import { auth_brand_opensource } from '@nibleaf/i18n/messages/auth_brand_opensource';
import { auth_brand_status } from '@nibleaf/i18n/messages/auth_brand_status';
import { auth_divider_or } from '@nibleaf/i18n/messages/auth_divider_or';
import { auth_error_servererror } from '@nibleaf/i18n/messages/auth_error_servererror';
import { auth_error_suspended } from '@nibleaf/i18n/messages/auth_error_suspended';
import { auth_error_tryagain } from '@nibleaf/i18n/messages/auth_error_tryagain';
import { auth_field_email } from '@nibleaf/i18n/messages/auth_field_email';
import { auth_field_name } from '@nibleaf/i18n/messages/auth_field_name';
import { auth_field_nameplaceholder } from '@nibleaf/i18n/messages/auth_field_nameplaceholder';
import { auth_google_signin } from '@nibleaf/i18n/messages/auth_google_signin';
import { auth_google_signup } from '@nibleaf/i18n/messages/auth_google_signup';
import { auth_google_submitting } from '@nibleaf/i18n/messages/auth_google_submitting';
import { auth_invite_invitedas } from '@nibleaf/i18n/messages/auth_invite_invitedas';
import { auth_legal_agreesuffix } from '@nibleaf/i18n/messages/auth_legal_agreesuffix';
import { auth_legal_and } from '@nibleaf/i18n/messages/auth_legal_and';
import { auth_legal_continueprefix } from '@nibleaf/i18n/messages/auth_legal_continueprefix';
import { auth_legal_privacy } from '@nibleaf/i18n/messages/auth_legal_privacy';
import { auth_legal_signupclosed } from '@nibleaf/i18n/messages/auth_legal_signupclosed';
import { auth_legal_signupdisabled } from '@nibleaf/i18n/messages/auth_legal_signupdisabled';
import { auth_legal_terms } from '@nibleaf/i18n/messages/auth_legal_terms';
import { auth_legal_termsrequired } from '@nibleaf/i18n/messages/auth_legal_termsrequired';
import { auth_name_required } from '@nibleaf/i18n/messages/auth_name_required';
import { auth_oauth_signinnotice } from '@nibleaf/i18n/messages/auth_oauth_signinnotice';
import { auth_otp_changedetails } from '@nibleaf/i18n/messages/auth_otp_changedetails';
import { auth_otp_checkemail } from '@nibleaf/i18n/messages/auth_otp_checkemail';
import { auth_otp_codelocked } from '@nibleaf/i18n/messages/auth_otp_codelocked';
import { auth_otp_differentemail } from '@nibleaf/i18n/messages/auth_otp_differentemail';
import { auth_otp_hint } from '@nibleaf/i18n/messages/auth_otp_hint';
import { auth_otp_invalid } from '@nibleaf/i18n/messages/auth_otp_invalid';
import { auth_otp_label } from '@nibleaf/i18n/messages/auth_otp_label';
import { auth_otp_openinbox } from '@nibleaf/i18n/messages/auth_otp_openinbox';
import { auth_otp_resend } from '@nibleaf/i18n/messages/auth_otp_resend';
import { auth_otp_resendin } from '@nibleaf/i18n/messages/auth_otp_resendin';
import { auth_otp_resendready } from '@nibleaf/i18n/messages/auth_otp_resendready';
import { auth_otp_resendwait } from '@nibleaf/i18n/messages/auth_otp_resendwait';
import { auth_otp_sendcreate } from '@nibleaf/i18n/messages/auth_otp_sendcreate';
import { auth_otp_senderror } from '@nibleaf/i18n/messages/auth_otp_senderror';
import { auth_otp_sending } from '@nibleaf/i18n/messages/auth_otp_sending';
import { auth_otp_sendsignin } from '@nibleaf/i18n/messages/auth_otp_sendsignin';
import { auth_otp_sentto } from '@nibleaf/i18n/messages/auth_otp_sentto';
import { auth_otp_toomanyattempts } from '@nibleaf/i18n/messages/auth_otp_toomanyattempts';
import { auth_otp_verifycreate } from '@nibleaf/i18n/messages/auth_otp_verifycreate';
import { auth_otp_verifying } from '@nibleaf/i18n/messages/auth_otp_verifying';
import { auth_otp_verifysignin } from '@nibleaf/i18n/messages/auth_otp_verifysignin';
import { auth_otp_waitbeforeretry } from '@nibleaf/i18n/messages/auth_otp_waitbeforeretry';
import { auth_passwordless_continue } from '@nibleaf/i18n/messages/auth_passwordless_continue';
import { auth_passwordless_description } from '@nibleaf/i18n/messages/auth_passwordless_description';
import { auth_passwordless_oldlink } from '@nibleaf/i18n/messages/auth_passwordless_oldlink';
import { auth_passwordless_subtitle } from '@nibleaf/i18n/messages/auth_passwordless_subtitle';
import { auth_signin_createone } from '@nibleaf/i18n/messages/auth_signin_createone';
import { auth_signin_error } from '@nibleaf/i18n/messages/auth_signin_error';
import { auth_signin_noaccount } from '@nibleaf/i18n/messages/auth_signin_noaccount';
import { auth_signin_submit } from '@nibleaf/i18n/messages/auth_signin_submit';
import { auth_signin_subtitle } from '@nibleaf/i18n/messages/auth_signin_subtitle';
import { auth_signup_error } from '@nibleaf/i18n/messages/auth_signup_error';
import { auth_signup_haveaccount } from '@nibleaf/i18n/messages/auth_signup_haveaccount';
import { auth_signup_submit } from '@nibleaf/i18n/messages/auth_signup_submit';
import { auth_signup_subtitle } from '@nibleaf/i18n/messages/auth_signup_subtitle';
import { auth_verify_codelabel } from '@nibleaf/i18n/messages/auth_verify_codelabel';
import { auth_verify_enteremail } from '@nibleaf/i18n/messages/auth_verify_enteremail';
import { auth_verify_invalidcode } from '@nibleaf/i18n/messages/auth_verify_invalidcode';
import { auth_verify_invalidlinkenteremail } from '@nibleaf/i18n/messages/auth_verify_invalidlinkenteremail';
import { auth_verify_invalidlinkresend } from '@nibleaf/i18n/messages/auth_verify_invalidlinkresend';
import { auth_verify_noemail } from '@nibleaf/i18n/messages/auth_verify_noemail';
import { auth_verify_resend } from '@nibleaf/i18n/messages/auth_verify_resend';
import { auth_verify_resending } from '@nibleaf/i18n/messages/auth_verify_resending';
import { auth_verify_sendcode } from '@nibleaf/i18n/messages/auth_verify_sendcode';
import { auth_verify_senderror } from '@nibleaf/i18n/messages/auth_verify_senderror';
import { auth_verify_sentto } from '@nibleaf/i18n/messages/auth_verify_sentto';
import { auth_verify_senttoast } from '@nibleaf/i18n/messages/auth_verify_senttoast';
import { auth_verify_submit } from '@nibleaf/i18n/messages/auth_verify_submit';
import { auth_verify_submitting } from '@nibleaf/i18n/messages/auth_verify_submitting';
import { auth_verify_subtitle } from '@nibleaf/i18n/messages/auth_verify_subtitle';
import { auth_verify_title } from '@nibleaf/i18n/messages/auth_verify_title';
import { auth_verify_verified } from '@nibleaf/i18n/messages/auth_verify_verified';
import { auth_verify_verifiedtoast } from '@nibleaf/i18n/messages/auth_verify_verifiedtoast';
import { auth_verify_verifying } from '@nibleaf/i18n/messages/auth_verify_verifying';
import { common_cancel } from '@nibleaf/i18n/messages/common_cancel';
import { common_delete } from '@nibleaf/i18n/messages/common_delete';
import { common_loading } from '@nibleaf/i18n/messages/common_loading';
import { common_save } from '@nibleaf/i18n/messages/common_save';
import { deploy_close } from '@nibleaf/i18n/messages/deploy_close';
import { error_title } from '@nibleaf/i18n/messages/error_title';
import { error_tryagain } from '@nibleaf/i18n/messages/error_tryagain';
import { error_unexpected } from '@nibleaf/i18n/messages/error_unexpected';
import { settings_account_email_inuse } from '@nibleaf/i18n/messages/settings_account_email_inuse';
import { settings_account_email_sameascurrent } from '@nibleaf/i18n/messages/settings_account_email_sameascurrent';
import { validation_emailinvalid } from '@nibleaf/i18n/messages/validation_emailinvalid';
import { validation_emailrequired } from '@nibleaf/i18n/messages/validation_emailrequired';
import { validation_required } from '@nibleaf/i18n/messages/validation_required';
import { useScopedLocale } from '@nibleaf/i18n/scoped';

const AUTH_MESSAGES = {
  'account.language': account_language,
  'account.language.description': account_language_description,
  'account.language.noResults': account_language_noresults,
  'account.language.search': account_language_search,
  'auth.backToSignIn': auth_backtosignin,
  'auth.backToSite': auth_backtosite,
  'auth.brand.description': auth_brand_description,
  'auth.brand.domains': auth_brand_domains,
  'auth.brand.heading': auth_brand_heading,
  'auth.brand.hosting': auth_brand_hosting,
  'auth.brand.multilingual': auth_brand_multilingual,
  'auth.brand.openSource': auth_brand_opensource,
  'auth.brand.status': auth_brand_status,
  'auth.divider.or': auth_divider_or,
  'auth.error.serverError': auth_error_servererror,
  'auth.error.suspended': auth_error_suspended,
  'auth.error.tryAgain': auth_error_tryagain,
  'auth.field.email': auth_field_email,
  'auth.field.name': auth_field_name,
  'auth.field.namePlaceholder': auth_field_nameplaceholder,
  'auth.google.signIn': auth_google_signin,
  'auth.google.signUp': auth_google_signup,
  'auth.google.submitting': auth_google_submitting,
  'auth.invite.invitedAs': auth_invite_invitedas,
  'auth.legal.agreeSuffix': auth_legal_agreesuffix,
  'auth.legal.and': auth_legal_and,
  'auth.legal.continuePrefix': auth_legal_continueprefix,
  'auth.legal.privacy': auth_legal_privacy,
  'auth.legal.signupClosed': auth_legal_signupclosed,
  'auth.legal.signupDisabled': auth_legal_signupdisabled,
  'auth.legal.terms': auth_legal_terms,
  'auth.legal.termsRequired': auth_legal_termsrequired,
  'auth.name.required': auth_name_required,
  'auth.oauth.signInNotice': auth_oauth_signinnotice,
  'auth.otp.changeDetails': auth_otp_changedetails,
  'auth.otp.checkEmail': auth_otp_checkemail,
  'auth.otp.codeLocked': auth_otp_codelocked,
  'auth.otp.differentEmail': auth_otp_differentemail,
  'auth.otp.hint': auth_otp_hint,
  'auth.otp.invalid': auth_otp_invalid,
  'auth.otp.label': auth_otp_label,
  'auth.otp.openInbox': auth_otp_openinbox,
  'auth.otp.resend': auth_otp_resend,
  'auth.otp.resendIn': auth_otp_resendin,
  'auth.otp.resendReady': auth_otp_resendready,
  'auth.otp.resendWait': auth_otp_resendwait,
  'auth.otp.sendCreate': auth_otp_sendcreate,
  'auth.otp.sendError': auth_otp_senderror,
  'auth.otp.sendSignIn': auth_otp_sendsignin,
  'auth.otp.sending': auth_otp_sending,
  'auth.otp.sentTo': auth_otp_sentto,
  'auth.otp.tooManyAttempts': auth_otp_toomanyattempts,
  'auth.otp.verifyCreate': auth_otp_verifycreate,
  'auth.otp.verifySignIn': auth_otp_verifysignin,
  'auth.otp.verifying': auth_otp_verifying,
  'auth.otp.waitBeforeRetry': auth_otp_waitbeforeretry,
  'auth.passwordless.continue': auth_passwordless_continue,
  'auth.passwordless.description': auth_passwordless_description,
  'auth.passwordless.oldLink': auth_passwordless_oldlink,
  'auth.passwordless.subtitle': auth_passwordless_subtitle,
  'auth.signIn.createOne': auth_signin_createone,
  'auth.signIn.error': auth_signin_error,
  'auth.signIn.noAccount': auth_signin_noaccount,
  'auth.signIn.submit': auth_signin_submit,
  'auth.signIn.subtitle': auth_signin_subtitle,
  'auth.signUp.error': auth_signup_error,
  'auth.signUp.haveAccount': auth_signup_haveaccount,
  'auth.signUp.submit': auth_signup_submit,
  'auth.signUp.subtitle': auth_signup_subtitle,
  'auth.verify.codeLabel': auth_verify_codelabel,
  'auth.verify.enterEmail': auth_verify_enteremail,
  'auth.verify.invalidCode': auth_verify_invalidcode,
  'auth.verify.invalidLinkEnterEmail': auth_verify_invalidlinkenteremail,
  'auth.verify.invalidLinkResend': auth_verify_invalidlinkresend,
  'auth.verify.noEmail': auth_verify_noemail,
  'auth.verify.resend': auth_verify_resend,
  'auth.verify.resending': auth_verify_resending,
  'auth.verify.sendCode': auth_verify_sendcode,
  'auth.verify.sendError': auth_verify_senderror,
  'auth.verify.sentTo': auth_verify_sentto,
  'auth.verify.sentToast': auth_verify_senttoast,
  'auth.verify.submit': auth_verify_submit,
  'auth.verify.submitting': auth_verify_submitting,
  'auth.verify.subtitle': auth_verify_subtitle,
  'auth.verify.title': auth_verify_title,
  'auth.verify.verified': auth_verify_verified,
  'auth.verify.verifiedToast': auth_verify_verifiedtoast,
  'auth.verify.verifying': auth_verify_verifying,
  'common.cancel': common_cancel,
  'common.delete': common_delete,
  'common.loading': common_loading,
  'common.save': common_save,
  'deploy.close': deploy_close,
  'error.title': error_title,
  'error.tryAgain': error_tryagain,
  'error.unexpected': error_unexpected,
  'settings.account.email.inUse': settings_account_email_inuse,
  'settings.account.email.sameAsCurrent': settings_account_email_sameascurrent,
  'validation.emailInvalid': validation_emailinvalid,
  'validation.emailRequired': validation_emailrequired,
  'validation.required': validation_required,
} as const;

type AuthMessageKey = keyof typeof AUTH_MESSAGES;
export type AuthTranslate = (key: AuthMessageKey, variables?: MessageVariables) => string;

/** `useLocale()` for the auth surfaces: the locale, its setter, and `t` over AUTH_MESSAGES. */
export const useAuthLocale = () => useScopedLocale(AUTH_MESSAGES);
/** `useT()` for the auth surfaces. */
export const useAuthT = (): AuthTranslate => useAuthLocale().t;
