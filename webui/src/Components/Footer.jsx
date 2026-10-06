import {
  Container,
  Text,
  Link,
  useBreakpointValue,
} from '@chakra-ui/react';
import { SupportMessage } from './SupportLink';

export default function Footer() {
  const maxW = useBreakpointValue({
    base: '1280px',
    sm: '1280px',
    md: '1280px',
    xl: '1280px',
    '2xl': '1600px',
  });
  return (
    <Container
      display="flex"
      px={4}
      maxW={maxW}
      py={4}
      flexDirection={{ base: 'column', md: 'row' }}
      gap={4}
      justifyContent={{ base: 'center', md: 'space-between' }}
      alignItems={{ base: 'center', md: 'center' }}
    >
      <Text textStyle="utility" color="footerLink">
        Maintained with &#10084; by{' '}
        <Link href="https://github.com/bsord" color="footerLink" target="_blank" rel="noopener noreferrer">
          bsord
        </Link>{' '}
        and{' '}
        <Link href="https://fairbanks.io" color="footerLink" target="_blank" rel="noopener noreferrer">
          jonfairbanks
        </Link>
      </Text>
      <SupportMessage textAlign={{ base: 'center', md: 'right' }} />
    </Container>
  );
}
