import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "@react-email/components";

export interface ResetPasswordEmailProps {
  resetUrl: string;
}

const tailwindConfig = {
  presets: [pixelBasedPreset],
};

export function ResetPasswordEmail({
  resetUrl,
}: ResetPasswordEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Password reset instructions</Preview>
      <Tailwind config={tailwindConfig}>
        <Body className="m-0 bg-[#f4efe6] px-[24px] py-[32px] font-serif text-[#21180d]">
          <Container className="mx-auto max-w-[560px] rounded-[28px] border border-[#eadfcd] bg-[#fffaf3] px-[28px] py-[32px]">
            <Text className="m-0 text-[12px] uppercase tracking-[2px] text-[#bb4d1e]">
              Security
            </Text>
            <Heading className="mb-[12px] mt-[18px] text-[32px] leading-[36px] text-[#21180d]">
              Reset your password
            </Heading>
            <Text className="m-0 text-[16px] leading-[26px] text-[#4e4032]">
              Use the secure link below to reset your password. If you did not request this
              change, you can safely ignore this email.
            </Text>

            <Section className="py-[28px]">
              <Button
                href={resetUrl}
                className="rounded-full bg-[#bb4d1e] px-[20px] py-[14px] text-[14px] font-semibold text-[#fffaf4] no-underline"
              >
                Reset password
              </Button>
            </Section>

            <Hr className="my-0 border-[#eadfcd]" />

            <Section className="pt-[24px]">
              <Text className="m-0 text-[13px] leading-[22px] text-[#65594a]">
                If the button does not work, copy and paste this link into your browser:
              </Text>
              <Text className="mb-0 mt-[10px] break-all text-[13px] leading-[22px] text-[#65594a]">
                {resetUrl}
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

ResetPasswordEmail.PreviewProps = {
  resetUrl: "https://acme.dev/reset/preview",
} satisfies ResetPasswordEmailProps;
