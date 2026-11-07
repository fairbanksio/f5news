import { Alert } from '@chakra-ui/react';
import { useColorModeValue } from '../Contexts/ColorModeContext';

const ServiceNotice = () => {
  const colors = useColorModeValue(
    { background: 'blue.50', border: 'blue.200', text: 'blue.900' },
    { background: 'blue.950', border: 'blue.800', text: 'blue.100' },
  );

  return (
    <Alert.Root
      status='info'
      role='status'
      aria-label='Reddit Access Notice'
      bg={colors.background}
      color={colors.text}
      borderWidth='1px'
      borderColor={colors.border}
      borderRadius='md'
      alignItems='center'
      px={4}
      py={3}
      mb={4}
    >
      <Alert.Indicator color='inherit' />
      <Alert.Description textAlign='left' fontSize='sm' lineHeight='1.6'>
        Reddit is aggressively{' '}
        <a
          href='https://www.reddit.com/r/redditdev/comments/1vgbm9c/our_plans_for_the_future_of_reddits_public_data/'
          style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}
        >
          restricting access
        </a>{' '}
        to their API. We are working on ways to mitigate this, but there may be interruptions in the meantime.
      </Alert.Description>
    </Alert.Root>
  );
};

export default ServiceNotice;
