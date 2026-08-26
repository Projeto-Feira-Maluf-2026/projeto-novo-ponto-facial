"""Transactional attendance notifications sent through Brevo SMTP."""

import asyncio
import logging
import smtplib
import ssl
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr
from html import escape

from app.core.config import settings
from app.core.time import as_local
from app.models.enums import PunchType

logger = logging.getLogger(__name__)

PUNCH_LABELS = {
    PunchType.ENTRY: "Entrada",
    PunchType.LUNCH_OUT: "Saída para almoço",
    PunchType.LUNCH_IN: "Retorno do almoço",
    PunchType.EXIT: "Saída",
}


class AttendanceEmailNotifier:
    """Sends confirmations without ever exposing SMTP credentials in logs."""

    async def send_confirmation(
        self,
        *,
        recipient: str | None,
        employee_name: str,
        worksite_name: str,
        punch_type: PunchType,
        occurred_at: datetime,
        record_id: str,
    ) -> bool:
        if not settings.EMAIL_NOTIFICATIONS_ENABLED or not recipient:
            return False

        message = self._build_message(
            recipient=recipient,
            employee_name=employee_name,
            worksite_name=worksite_name,
            punch_type=punch_type,
            occurred_at=occurred_at,
            record_id=record_id,
        )
        try:
            await asyncio.wait_for(
                asyncio.to_thread(self._send_sync, message),
                timeout=settings.EMAIL_TIMEOUT_SECONDS + 2,
            )
        except Exception as exc:  # O ponto ja foi salvo; email nunca pode desfaze-lo.
            logger.warning(
                "Falha ao enviar confirmacao de ponto record_id=%s error_type=%s",
                record_id,
                type(exc).__name__,
            )
            return False

        logger.info("Confirmacao de ponto enviada record_id=%s", record_id)
        return True

    def _build_message(
        self,
        *,
        recipient: str,
        employee_name: str,
        worksite_name: str,
        punch_type: PunchType,
        occurred_at: datetime,
        record_id: str,
    ) -> EmailMessage:
        local_time = self._to_local_time(occurred_at)
        punch_label = PUNCH_LABELS[punch_type]
        date_label = local_time.strftime("%d/%m/%Y")
        time_label = local_time.strftime("%H:%M")
        subject = f"Ponto registrado — {punch_label}"

        message = EmailMessage()
        message["From"] = formataddr(
            (settings.EMAIL_FROM_NAME, settings.EMAIL_FROM_ADDRESS or "")
        )
        message["To"] = recipient
        message["Subject"] = subject
        message["Message-ID"] = f"<attendance-{record_id}@curitiba-empreiteira>"
        message["X-Attendance-Record-ID"] = record_id
        message.set_content(
            "\n".join(
                [
                    f"Olá, {employee_name}.",
                    "",
                    f"Seu ponto de {punch_label.lower()} foi registrado com sucesso.",
                    f"Obra: {worksite_name}",
                    f"Data: {date_label}",
                    f"Horário: {time_label}",
                    "",
                    "Curitiba Empreiteira",
                ]
            )
        )
        message.add_alternative(
            f"""\
<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f4f6f2;font-family:Arial,sans-serif;color:#152019">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px">
      <div style="background:#ffffff;border:1px solid #dde4dc;border-radius:16px;padding:28px">
        <p style="margin:0 0 8px;color:#207548;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Curitiba Empreiteira</p>
        <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25">Ponto registrado</h1>
        <p style="margin:0 0 20px;line-height:1.6">Olá, {escape(employee_name)}. Seu ponto de <strong>{escape(punch_label.lower())}</strong> foi registrado com sucesso.</p>
        <div style="background:#f4f6f2;border-radius:12px;padding:18px;line-height:1.8">
          <div><strong>Obra:</strong> {escape(worksite_name)}</div>
          <div><strong>Data:</strong> {date_label}</div>
          <div><strong>Horário:</strong> {time_label}</div>
        </div>
      </div>
    </div>
  </body>
</html>
""",
            subtype="html",
        )
        return message

    @staticmethod
    def _to_local_time(value: datetime) -> datetime:
        return as_local(value)

    @staticmethod
    def _send_sync(message: EmailMessage) -> None:
        login = settings.email_smtp_login
        smtp_key = settings.BREVO_SMTP_KEY
        if not login or not smtp_key:
            raise RuntimeError("Credenciais SMTP ausentes")

        context = ssl.create_default_context()
        with smtplib.SMTP(
            settings.BREVO_SMTP_HOST,
            settings.BREVO_SMTP_PORT,
            timeout=settings.EMAIL_TIMEOUT_SECONDS,
        ) as client:
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
            client.login(login, smtp_key)
            client.send_message(message)
