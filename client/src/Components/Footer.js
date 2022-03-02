import {
  Container,
  Stack,
  Text,
  Link,
  Icon
} from '@chakra-ui/react';
import { FaGithub } from 'react-icons/fa';

export default function Footer() {
  return (
      <Container
        as={Stack}
        maxW='container.xl'
        py={4}
        direction={{ base: 'column', md: 'row' }}
        spacing={4}
        justify={{ base: 'center', md: 'space-between' }}
        align={{ base: 'center', md: 'center' }}>
        <Text>Maintained with &#10084; by <Link href="https://github.com/bsord" isExternal>bsord</Link> and <Link href="https://github.com/jonfairbanks" isExternal>jonfairbanks</Link></Text>
        <Stack direction={'row'} spacing={6}>
          <Link href='https://github.com/Fairbanks-io/f5-client/issues/new' isExternal>
            Request a subreddit <Icon as={FaGithub} mx='2px' />
          </Link>
        </Stack>
      </Container>
  );
}