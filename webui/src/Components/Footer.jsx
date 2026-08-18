import {
  Container,
  Flex,
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
  const footerDirection = useBreakpointValue({ base: 'column', md: 'row' }, { ssr: false });
  const footerJustify = useBreakpointValue({ base: 'center', md: 'space-between' }, { ssr: false });
  const footerTextAlign = useBreakpointValue({ base: 'center', md: 'left' }, { ssr: false });

  return (
    <Container
      maxW={maxW}
      py={4}
    >
      <Flex
        direction={footerDirection}
        gap={4}
        justify={footerJustify}
        align="center"
        textAlign={footerTextAlign}
        w="100%"
      >
        <Text textStyle="utility" color="footerLink">
          Maintained with &#10084; by{' '}
          <Link
            href="https://github.com/bsord"
            color="footerLink"
            target="_blank"
            rel="noopener noreferrer"
            _hover={{ color: 'footerLink', textDecoration: 'underline' }}
          >
            bsord
          </Link>{' '}
          and{' '}
          <Link
            href="https://fairbanks.io"
            color="footerLink"
            target="_blank"
            rel="noopener noreferrer"
            _hover={{ color: 'footerLink', textDecoration: 'underline' }}
          >
            jonfairbanks
          </Link>
        </Text>
        <SupportMessage textAlign={{ base: 'center', md: 'right' }} />
      </Flex>
    </Container>
  );
}
