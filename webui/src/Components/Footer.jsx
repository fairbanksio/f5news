import {
  Container,
  Stack,
  Text,
  Link,
  useBreakpointValue,
} from '@chakra-ui/react';
import { SupportMessage } from './SupportLink';

export default function Footer() {
  const maxW = useBreakpointValue({
    base: 'container.xl',
    sm: 'container.xl',
    md: 'container.xl',
    xl: 'container.xl',
    '2xl': '1600px',
  });
  return (
    <Container
      as={Stack}
      maxW={maxW}
      py={4}
      direction={{ base: 'column', md: 'row' }}
      spacing={4}
      justify={{ base: 'center', md: 'space-between' }}
      align={{ base: 'center', md: 'center' }}
    >
      <Text textStyle="utility" color="footerLink">
        Maintained with &#10084; by{' '}
        <Link href="https://github.com/bsord" color="footerLink" isExternal>
          bsord
        </Link>{' '}
        and{' '}
        <Link href="https://fairbanks.io" color="footerLink" isExternal>
          jonfairbanks
        </Link>
      </Text>
      <SupportMessage textAlign={{ base: 'center', md: 'right' }} />
    </Container>
  );
}
